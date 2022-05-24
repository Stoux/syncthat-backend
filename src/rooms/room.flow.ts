import {Server, Socket} from "socket.io";
import {
    AddSong as AddSongMessage,
    ChatMessage,
    Join as JoinMessage,
    Notice,
    SkipToTimestamp,
    VoteOnCurrentSong
} from "./room.messages";
import {v4} from 'uuid'
import {RoomController} from "./room.controller";
import {
    CurrentSong,
    LogChatMessage,
    LogMessage,
    LogMessageType,
    LogNotification,
    NotificationType,
    Song
} from "./room.models";
import {ReactiveVar} from "../util/ReactiveVar";
import {DownloadResult, SongsService} from "../songs/songs.service";
import {BroadcastOperator} from "socket.io/dist/broadcast-operator";
import {DefaultEventsMap} from "socket.io/dist/typed-events";
import {ConfigService} from "@nestjs/config";


const TIME_TILL_KICK = 60 * 1000; // Get kicked after a minute.
const MAX_LOG_LENGTH = 1000; // Number of messages in the log to keep track of
const LOG_WIPE_AFTER_MILLISECONDS = 12 * 60 * 60 * 1000; // Number of MS before messages should be wiped from the history.

export class RoomHandler {


    private readonly broadcastId: string;
    private currentSong: ReactiveVar<CurrentSong | null>;
    private songsQueue: ReactiveVar<Song[]>;
    private playedSongs: ReactiveVar<Song[]>;
    private users: ConnectedUser[];
    private events: RoomEvents;
    private log: ReactiveVar<LogMessage[]>;

    constructor(
        private readonly songService: SongsService,
        private readonly configService: ConfigService,
        private readonly server: Server,
        public readonly roomId: number
    ) {
        this.server = server;
        this.broadcastId = `room-${roomId}`;

        this.users = [];
        this.songsQueue = new ReactiveVar<Song[]>([]);
        this.playedSongs = new ReactiveVar<Song[]>([]);
        this.currentSong = new ReactiveVar<CurrentSong | null>(null);
        this.log = new ReactiveVar<LogMessage[]>([]);

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
                    this.onCurrentSongEnd();
                });
            }
        });
        this.songsQueue.subscribe(songs => {
            this.broadcast('queue', songs);
        })
        this.playedSongs.subscribe(songs => {
            this.broadcast('played-songs', songs);
        });
        this.log.subscribe(messages => {
            if (messages.length > MAX_LOG_LENGTH) {
                this.log.set(messages.slice(0, MAX_LOG_LENGTH));
            } else {
                this.broadcast('log', messages);
            }
        });

        // Register event loop
        const events: RoomEvents = new RoomEvents();

        // Interval that kicks disconnected users.
        events.userCheck = setInterval(() => RoomEvents.doUserCheck(this.users, users => {
            this.users.filter(element => !users.includes(element)).forEach(deletedUser => this.addNotificationToLog(
                `[${deletedUser.name}] is no longer a cool kid. Bye!`,
                NotificationType.USER_LEAVE,
                '🤏'
            ));

            this.users = users;
            this.emitUsers();
        }), 15 * 1000);

        // Interval that wipes old messages
        setInterval(() => {
            const log = this.log.get();
            if (log.length) {
                return;
            }

            const now = (new Date()).getTime();
            const newLog = log.filter(item => item.timestamp < now - LOG_WIPE_AFTER_MILLISECONDS);
            if (newLog.length !== log.length) {
                this.log.set(newLog);
            }
        }, 1000 * 60 * 1000)

        return events;
    }

    private onCurrentSongEnd() {
        const song = this.currentSong.get().song;
        song.stoppedAt = (new Date()).getTime();

        // Add the song to the list of played songs
        let playedSongs = this.playedSongs.get();
        playedSongs.unshift(song);
        if (playedSongs.length > 20) {
            playedSongs = playedSongs.slice(0, 20);
        }
        this.playedSongs.set(playedSongs);

        // Song has ended; set it to null & possibly play the next track.
        this.currentSong.set(null);
        this.possiblyPlayNextSong();
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
        console.log('New user connecting', message);

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

            console.log('User has rejoined the room', foundUser);
        } else {
            // Create a new user
            foundUser = new ConnectedUser(
                socket.id,
                v4(),
                v4(),
                message.name ? message.name : RoomController.generateDutchName(),
            )
            this.users.push(foundUser);

            this.addNotificationToLog(`[${foundUser.name}] is now in sync.`, NotificationType.USER_JOIN, '🙌');
            console.log('New user has joined the room', foundUser);
        }

        // Let the user join the broadcast room
        socket.join(this.broadcastId);
        socket.emit('you', foundUser.toPrivateData());
        this.emitUsers();
        socket.emit('current-song', this.currentSong.get());
        socket.emit('queue', this.songsQueue.get());
        socket.emit('log', this.log.get());

        return true;
    }

    public queueSong(socket: Socket, message: AddSongMessage) {
        const user = this.getAdmin(socket);
        if (!user) return;

        this.emitNotice(socket, { message: 'Fetching metadata for URL'});

        const downloadCallback = (result: DownloadResult) => {
            // Find the song.
            let song = this.songsQueue.get().find(s => s.key === result.key);
            if (!song) {
                const currentSong = this.currentSong.get();
                if (currentSong && currentSong.song && currentSong.song.key === result.key) {
                    song = currentSong.song;
                }
            }
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
            song.waveformGenerated = result.waveformGenerated === undefined ? false : result.waveformGenerated;

            song.ready = result.success === true;
            this.songsQueue.trigger();

            // Check if we can pop it from the queue
            if (result.success) {
                this.possiblyPlayNextSong();
            }

            // Check if the current is us
            const currentSong = this.currentSong.get();
            console.log('Current', currentSong ? currentSong.song : null);
            if (currentSong && currentSong.song && currentSong.song.key === result.key) {
                console.log('Retrigger want current song, wats die progress tho', song.waveformGenerated);
                this.currentSong.trigger();
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
            const addedBy = this.users.find(u => u.socketId === socket.id)
            const song = new Song(result.key, result.title, result.success === true, result.duration, result.waveformGenerated, result.songInfo, addedBy?.publicId );
            songs.push(song);
            return songs;
        })
        this.emitNotice(socket, {message: 'Song has been added to the queue'});
        console.log('Added song to queue', result.title);
        this.possiblyPlayNextSong();

        this.addNotificationToLog(`[${user.name}] has queued [${result.title}]!`, NotificationType.SONG_ADDED_TO_QUEUE, '🕺');

        // TODO: Broadcast notice?
    }

    public skipSong(socket: Socket) {
        const user = this.getAdmin(socket);
        if (!user) return;

        const song = this.currentSong.get();
        if (!song) {
            this.emitNotice(socket, { message: 'Nothing is playing right now.', type: 'error'});
            return;
        }

        // TODO: Check if there are upvotes -> Change message
        // TODO: Check if the song was queued by the current user

        this.addNotificationToLog(`Classic. [${user.name}] has skipped the current track!`, NotificationType.SONG_FORCE_SKIPPED, '🕺');

        console.log('Song has been skipped');
        this.onCurrentSongEnd();
    }

    public skipSongToTimestamp(socket: Socket, message: SkipToTimestamp) {
        if (!this.getAdmin(socket)) return;

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

    public becomeAdmin(socket: Socket, password: string) {
        const user = this.findUser(socket);
        if (!user) {
            return;
        }

        if (user.admin) {
            this.emitNotice(socket, {message: 'You\'re already an admin!'});
        } else {
            const configPassword = this.configService.get<string>('ADMIN_PASSWORD');
            console.log(configPassword, password);
            if (password === configPassword) {
                user.admin = true;
                this.emitUsers();
                socket.emit('you', user.toPrivateData());
                this.emitNotice(socket, {message: 'You an admin now!'});
                console.log(user.name, 'is now an admin');
            } else {
                this.emitNotice(socket, {type: 'error', message: 'Nope.'})
                console.log(user.name, 'failed to become an admin');
            }
        }

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
        song.playedAt = (new Date()).getTime();
        this.currentSong.set(new CurrentSong(song));
    }

    protected getAdmin(socket: Socket, emitNotice: boolean = true): ConnectedUser|null {
        const user = this.findUser(socket);
        if (user && user.admin) {
            return user;
        }

        if (emitNotice) {
            this.emitNotice(socket, {type: 'error', message: 'Only admins can do that action.'})
        }

        return null;
    }


    private findUser(socket: Socket): ConnectedUser|null {
        return this.users.find(u => u.socketId === socket.id);
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

        this.emitUsers();
    }

    public onChatMessage(socket: Socket, chatMessage: ChatMessage): void {
        const user = this.users.find(u => u.socketId === socket.id);
        if (!user) {
            // TODO: Notice
            return;
        }

        if (chatMessage.message.length > 1000) {
            this.emitNotice(socket, { message: 'Hou die verhalen lekker voor je maat', type: 'error'});
            return;
        }

        this.addToLog(<LogChatMessage>{
            id: v4(),
            message: chatMessage.message,
            timestamp: (new Date()).getTime(),
            byId: user.publicId,
            name: user.name,
            type: LogMessageType.ChatMessage,
        })
    }

    public onVote(socket: Socket, vote: VoteOnCurrentSong) {
        const user = this.users.find(u => u.socketId === socket.id);
        if (!user) {
            // TODO: Notice
            return;
        }

        // Check if a song is currently playing
        const currentSong = this.currentSong.get();
        if (!currentSong) {
            this.emitNotice(socket, { message: 'Nothing is playing right now. You can\'t vote on nothing.', type: 'error' })
            return;
        }

        // Check if the vote changed
        if (currentSong.song.likedDisliked[user.publicId] === vote.vote) {
            this.emitNotice(socket, { message: 'That is already your current vote.', type: 'error' })
            return;
        }

        // Modify the vote & update the current song
        currentSong.song.likedDisliked[user.publicId] = vote.vote;
        this.currentSong.set(currentSong);
        this.emitNotice(socket, { message: 'You voted "' + (vote.vote === undefined ? 'nothing' : (vote.vote === true ? 'Yay' : 'Nay' )) + '"' })
    }

    public emitNotice(socket: Socket|Server|BroadcastOperator<DefaultEventsMap, any>, notice: Notice): void {
        const message: LogNotification = {
            id: v4(),
            type: LogMessageType.Notification,
            notificationType: NotificationType.PRIVATE_MESSAGE,
            message: notice.message,
            timestamp: (new Date()).getTime(),
            emoji: notice.type === 'error' ? '❌' : '✅',
        }
        socket.emit('private-message', message);
    }

    private emitUsers(): void {
        const users = this.users
            .map(u => u.toPublicData());

        this.broadcast('users', users);
    }

    private addNotificationToLog(message: string, type: NotificationType, emoji?: string): void {
        this.addToLog(<LogNotification>{
            id: v4(),
            timestamp: (new Date()).getTime(),
            message,
            type: LogMessageType.Notification,
            notificationType: type,
            emoji,
        })
    }

    private addToLog(logItem: LogMessage): void {
        this.log.modify(messages => {
            messages.push(logItem);
            return messages;
        })
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
        const timeout = endTimestamp - (new Date().getTime()) - (currentSong.lastCurrentSeconds * 1000) ;
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
        public emoji?: string,
    ) {
        this.socketId = socketId;
        this.admin = false;
    }

    public isConnected(): boolean {
        return !this.disconnectedSince && this.socketId !== undefined;
    }

    public toPublicData() {
        return {
            id: this.publicId,
            name: this.name,
            emoji: this.emoji,
            connected: this.isConnected(),
            admin: this.admin,
        }
    }

    public toPrivateData() {
        return {
            privateId: this.privateId,
            publicId: this.publicId,
            name: this.name,
            emoji: this.emoji,
            admin: this.admin,
        }
    }

}


