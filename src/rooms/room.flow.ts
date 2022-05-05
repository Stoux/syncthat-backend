import {Server, Socket} from "socket.io";
import {AddSong as AddSongMessage, Join as JoinMessage, Notice, SkipToTimestamp} from "./room.messages";
import {v4} from 'uuid'
import {RoomController} from "./room.controller";
import {CurrentSong, Room, Song} from "./room.models";
import {ReactiveVar} from "../util/ReactiveVar";
import {DownloadResult, SongsService} from "../songs/songs.service";
import {BroadcastOperator} from "socket.io/dist/broadcast-operator";
import {DefaultEventsMap} from "socket.io/dist/typed-events";


const TIME_TILL_KICK = 60 * 1000; // Get kicked after a minute.

export class RoomHandler {


    private server: Server;
    private broadcastId: string;
    public roomId: number;
    private currentSong: ReactiveVar<CurrentSong | null>;
    private songsQueue: ReactiveVar<Song[]>;
    private users: ConnectedUser[];
    private events: RoomEvents;

    constructor(private songService: SongsService, server: Server, roomId: number) {
        this.server = server;
        this.roomId = roomId;
        this.broadcastId = `room-${roomId}`;

        this.users = [];
        this.songsQueue = new ReactiveVar<Song[]>([]);
        this.currentSong = new ReactiveVar<CurrentSong | null>(null);

        this.events = this.startEvents();
    }

    private startEvents(): RoomEvents {
        // Register change listeners
        this.currentSong.subscribe(song => {
            this.broadcast('current-song', song);
            if (song) {
                console.log('Now playing', song.song.title, '@', song.lastCurrentSeconds, 'seconds');
                this.events.setTimeoutForEndOfSong(song, () => {
                    console.log('Song has ended.');
                    this.currentSong.set(null);
                    this.possiblyPlayNextSong();
                });
            }
        });
        this.songsQueue.subscribe(songs => {
            this.broadcast('queue', songs);
        })

        // Register event loop
        const events: RoomEvents = new RoomEvents();

        // Interval that kicks disconnected users.
        events.userCheck = setInterval(() => RoomEvents.doUserCheck(this.users, users => {
            this.users = users;
            this.emitUsers();
        }), 15 * 1000);

        return events;
    }

    private broadcast(event: string, message: any) {
        this.server.to(this.broadcastId).emit(event, message);
    }

    /**
     * A (possibly) new user has joined the room.
     * @param socket
     * @param message
     */
    public join(socket: Socket, message: JoinMessage): boolean {
        // Check if the user is reconnecting
        let foundUser = message.privateId ? this.users.find(user => user.privateId === message.privateId) : null;
        if (foundUser) {
            // Check if the user is already connected
            if (foundUser.socketId) {
                socket.emit('already-connected');
                socket.disconnect(true);
                return true;
            }

            // User has reconnected
            foundUser.socketId = socket.id;
            foundUser.disconnectedSince = null;
            if (message.name) {
                foundUser.name = message.name;
            }

            console.log('User has rejoined the room', foundUser.name, foundUser.publicId);
        } else {
            // Create a new user
            foundUser = new ConnectedUser(
                socket.id,
                v4(),
                v4(),
                message.name ? message.name : RoomController.generateDutchName(),
            )
            this.users.push(foundUser);

            console.log('New user has joined the room', foundUser.name, foundUser.publicId);
        }

        // Let the user join the broadcast room
        socket.join(this.broadcastId);
        socket.emit('you', foundUser.toPrivateData());
        this.emitUsers();
        socket.emit('current-song', this.currentSong.get());
        socket.emit('queue', this.songsQueue.get());

        return true;
    }

    public queueSong(socket: Socket, message: AddSongMessage) {
        if (!this.isAdmin(socket)) return;

        this.emitNotice(socket, { message: 'Fetching metadata for URL'});

        const downloadCallback = (result: DownloadResult) => {
            // Find the song.
            const song = this.songsQueue.get().find(s => s.key === result.key);
            if (!song) {
                // No longer in queue?
                result.unsubscribeFromProgress(downloadCallback);
                return;
            }

            // Check if download failed
            if (!result.isDownloading() && !result.success) {
                this.songsQueue.modify(songs => songs.filter(s => s.key !== result.key));
                this.emitNotice(this.server.to(this.broadcastId), { message: `Song "${result.title}" has been removed due to a failed download`})
                this.possiblyPlayNextSong();
                return;
            }


            // Update the status
            song.downloadProgress = result.progress;
            song.ready = result.success === true;
            this.songsQueue.trigger();

            // Check if we can pop it from the queue
            if (result.success) {
                this.possiblyPlayNextSong();
            }
        };

        const result = this.songService.downloadSong(message.url, downloadCallback);
        if (result.success === false) {
            // Failed to download
            this.emitNotice(socket, {type: 'error', message: `Unable to download the URL ${message.url}`})
            return;
        }

        // Check if already in the queue
        if (this.songsQueue.get().find(s => s.key === result.key)) {
            this.emitNotice(socket, {type: 'error', message: `Song is already in the queue`})
            return;
        }

        // Add the song to the end of the queue
        this.songsQueue.modify(songs => {
            songs.push(new Song(result.key, result.title, result.success === true, result.duration));
            return songs;
        })
        this.emitNotice(socket, {message: 'Song has been added to the queue'});
        console.log('Added song to queue', result.title);
        this.possiblyPlayNextSong();

        // TODO: Broadcast notice?
    }

    public skipSong(socket: Socket) {
        if (!this.isAdmin(socket)) return;

        // TODO: Show message in chat about event

        console.log('Song has been skipped');
        this.currentSong.set(null);
        this.possiblyPlayNextSong();
    }

    public skipSongToTimestamp(socket: Socket, message: SkipToTimestamp) {
        if (!this.isAdmin(socket)) return;

        // Check if there's a song playing
        const curSong = this.currentSong.get();
        if (!curSong) {
            this.emitNotice(socket, { type: 'error', message: `Nothing's playing right now...` });
            return;
        }

        // Check if the requested timestamp is in range
        const currentTime = (new Date()).getTime();
        let atTimestamp = message.atTimestamp ? message.atTimestamp : currentTime;
        if (atTimestamp < currentTime - 2000 || atTimestamp > currentTime + 2000) {
            // Outside the 4 seconds buffer window. Probably trying to break stuff.
            this.emitNotice(socket, { type: 'error', message: 'Invalid timestamp given' });
            return;
        }

        // Validate the time
        if (message.toSeconds < 0 || message.toSeconds >= curSong.song.durationInSeconds - 2) {
            this.emitNotice(socket, { type: 'error', message: `Ehh. That doesn't seem like a moment we can jump to.` });
            return;
        }

        // Jump to it.
        curSong.lastCurrentSeconds = message.toSeconds;
        curSong.eventTimestamp = atTimestamp;

        // TODO: We shouldn't update the caller..
        this.currentSong.set(curSong);
    }

    protected possiblyPlayNextSong(): void {
        // Check if there's still a song playing
        if (this.currentSong.get() !== null) {
            return;
        }

        // Check if there's anything in the queue
        const queue = this.songsQueue.get();
        if (queue.length  === 0) {
            return;
        }

        // Check if the first song can be played
        const song = queue[0];
        if (!song.ready) {
            // Probably still waiting for the download to finish
            return;
        }

        // The song can be played. Pop it from the queue & start playing it
        queue.shift();
        this.songsQueue.set(queue);
        this.currentSong.set(new CurrentSong(song));
    }

    protected isAdmin(socket: Socket, emitNotice: boolean = true): boolean {
        const user = this.users.find(u => u.socketId === socket.id);
        if (user && user.admin) {
            return true;
        }

        if (emitNotice) {
            this.emitNotice(socket, {type: 'error', message: 'Only admins can do that action.'})
        }

        return false;
    }


    /**
     * A user has disconnected from the socket.
     * @param socket
     */
    public onDisconnect(socket: Socket): void {
        // Check if the socket had a user in our room.
        const user = this.users.find(u => u.socketId === socket.id);
        if (!user) {
            return;
        }

        user.socketId = undefined;
        user.disconnectedSince = (new Date()).getTime();
    }

    public emitNotice(socket: Socket|Server|BroadcastOperator<DefaultEventsMap, any>, notice: Notice): void {
        socket.emit('notice', notice);
    }

    private emitUsers(): void {
        const users = this.users
            .filter(u => !u.disconnectedSince)
            .map(u => u.toPublicData());

        this.broadcast('users', users);
    }
}

class RoomEvents {
    endOfSong?: NodeJS.Timeout;
    userCheck?: NodeJS.Timeout;

    static doUserCheck(users: ConnectedUser[], updateUsers: (users: ConnectedUser[]) => void) {
        const kickBefore = (new Date()).getTime() - TIME_TILL_KICK;
        const keepUsers = users.filter(user => !user.disconnectedSince || user.disconnectedSince > kickBefore);
        if (keepUsers.length !== users.length) {
            updateUsers(keepUsers);
        }
    }

    public setTimeoutForEndOfSong(currentSong: CurrentSong, callback: () => void) {
        clearTimeout(this.endOfSong);
        // Determine when the song ends
        const endTimestamp = currentSong.eventTimestamp + (currentSong.song.durationInSeconds * 1000) + 1000 /* Add a single second buffer */;
        const timeout = endTimestamp - (new Date().getTime());
        this.endOfSong = setTimeout(callback, timeout);
        console.log('Song will be ending in', Math.ceil(timeout / 1000), 'seconds');
    }

}

class ConnectedUser {

    admin: boolean;
    /** Currently connected socket ID (if any) */
    socketId?: string;
    /** Timestamp since when this user was disconnected */
    disconnectedSince?: number;

    constructor(
        socketId: string,
        public privateId: string,
        public publicId: string,
        public name: string,
    ) {
        this.socketId = socketId;
        this.admin = true;
    }

    public isConnected(): boolean {
        return !this.disconnectedSince && this.socketId !== undefined;
    }

    public toPublicData() {
        return {
            id: this.publicId,
            name: this.name,
            connected: this.isConnected(),
            // admin: this.admin,
        }
    }

    public toPrivateData() {
        return {
            privateId: this.privateId,
            publicId: this.publicId,
            name: this.name,
            admin: this.admin,
        }
    }

}


