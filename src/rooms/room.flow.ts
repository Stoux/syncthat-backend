import {Server, Socket} from "socket.io";
import {
    AddSong as AddSongMessage,
    ChangeUser as ChangeUserMessage,
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
import {hasEmoji, find as findEmoji, random as randomEmoji} from "node-emoji";
import {ConfigService} from "../util/config.service";


const TIME_TILL_KICK = 60 * 1000; // Get kicked after a minute.
const TIME_TILL_INACTIVE = 30 * 1000; // Time (in ms) it takes before state is updated to 'inactive'
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
        events.userCheck = setInterval(() => RoomEvents.doUserCheck(this.users, this.songsQueue, this.currentSong, users => {
            this.users.filter(element => !users.includes(element)).forEach(deletedUser => this.addNotificationToLog(
                `[${deletedUser.name}] is no longer a cool kid. Bye!`,
                NotificationType.USER_LEAVE,
                '🤏'
            ));

            this.users = users;
            this.emitUsers();
        }), 15 * 1000);

        // Event to check if a user's active state has changed (generally from active => inactive)
        events.activityCheck = setInterval(() => {
            let updated = false;
            this.users.forEach(user => {
                if (user.updateActive()) {
                    updated = true;
                }
            })

            if (updated) {
                this.emitUsers();
            }
        }, 1000);

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
        clearTimeout(this.events.endOfSong);
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
            if (message.emoji && hasEmoji(message.emoji)) {
                foundUser.emoji = findEmoji(message.emoji).emoji;
            }

            console.log('User has rejoined the room', foundUser);
        } else {
            // Create a new user
            foundUser = new ConnectedUser(
                socket.id,
                v4(),
                v4(),
                message.name ? message.name : RoomController.generateDutchName(),
                randomEmoji().emoji,
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
        socket.emit('played-songs', this.playedSongs.get());
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



        const result = (() => {
            try {
                return this.songService.downloadSong(message.url, downloadCallback);
            } catch (e: any) {
                console.error(e);
                return null;
            }
        })();
        if (!result || result.success === false) {
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
        
        console.log('Added song to queue', result.title);
        this.possiblyPlayNextSong();

        this.addNotificationToLog(`[${user.name}] has queued [${result.title}]!`, NotificationType.SONG_ADDED_TO_QUEUE, '🕺');

        // TODO: Broadcast notice?
    }

    public skipSong(socket: Socket) {
        const user = this.findUser(socket);
        if (!user) return;

        const song = this.currentSong.get();
        if (user.admin) {
            if (!song) {
                this.emitNotice(socket, { message: 'Nothing is playing right now.', type: 'error'});
                return;
            }
        } else {
            if (song.song.requestedBy !== user.publicId) {
                this.emitNotice(socket, { message: 'You can only skip your own tracks..', type: 'error'});
                return;
            }
        }

        // TODO: Check if there are upvotes -> Change message
        // TODO: Check how much time was left

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

    public removeSongFromQueue(socket: Socket, songKey: string) {
        const user = this.getAdmin(socket);
        if (!user) return;

        const song = this.findSong(socket, songKey);
        if (!song) return;

        this.songsQueue.modify(songs => songs.filter(s => s.key !== songKey));
        this.addNotificationToLog(`[${user.name}] is literally wasting my bandwidth! [${song.songInfo.title}] has been removed from the queue.`, NotificationType.SONG_FORCE_SKIPPED, '🕺');
    }

    public forcePlaySongFromQueue(socket: Socket, songKey: string) {
        const user = this.getAdmin(socket);
        if (!user) return;

        const song = this.findSong(socket, songKey);
        if (!song) return;

        // Make sure the song can be forced to play
        if (!song.ready) {
            this.emitNotice(socket, { type: 'error', message: `This song isn't ready to be played yet. Wait for the download to finish!` });
            return;
        }

        // Check if the song is already at the top of the queue
        const queue = this.songsQueue.get();
        if (queue[0] !== song) {
            // Move the song up the queue
            const songIndex = queue.indexOf(song);
            queue.splice(songIndex, 1);
            queue.unshift(song);
            this.songsQueue.silentSet(queue);
        }

        // Force play the next song (which is now our song)
        this.onCurrentSongEnd();
        this.addNotificationToLog(`Hi, my name is [${user.name}]. I have no respect for the queue so I'm now playing [${song.songInfo.title}].`, NotificationType.SONG_FORCE_PLAYED, '🖕');
    }

    /**
     * @param socket
     * @param songKey
     * @param position zero-based position in the queue
     */
    public moveSongInQueue(socket: Socket, songKey: string, position: number) {
        const user = this.getAdmin(socket);
        if (!user) return;

        const song = this.findSong(socket, songKey);
        if (!song) return;

        const queue = this.songsQueue.get();
        const songIndex = queue.indexOf(song);
        if (songIndex === position) {
            this.emitNotice(socket, { type: 'error', message: `Song is already at that position.` });
            return;
        }

        queue.splice(songIndex, 1);
        queue.splice(position, 0, song )
        this.songsQueue.set(queue);
    }


    public becomeAdmin(socket: Socket, password: string) {
        const user = this.findUser(socket);
        if (!user) {
            return;
        }

        if (user.admin) {
            this.emitNotice(socket, {message: 'You\'re already an admin!'});
        } else {
            const configPassword = this.configService.adminPassword;
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

    public changeCurrentUser(socket: Socket, message: ChangeUserMessage) {
        const user = this.findUser(socket);
        if (!user) return;

        let changed = false;

        if (message.name) {
            const name = message.name;

            const oldName = user.name;
            const newName = name.trim();

            // Check if changed & available
            if (newName.length > 40 || newName.length === 0) {
                this.emitNotice(socket, { type: 'error', message: 'How about a normal name?'})
                return;
            }
            if (oldName === newName) {
                this.emitNotice(socket, { type: 'error', message: 'This name is already taken. By you, you idiot.'})
                return;
            }
            if (!this.isNameAvailable(newName, user.publicId)) {
                this.emitNotice(socket, { type: 'error', message: 'This name is already taken?'})
                return;
            }

            // Modify the name
            user.name = newName;
            changed = true;

            // Notify
            this.addNotificationToLog(`RIP in pieces [${oldName}]. Welcome [${newName}].`, NotificationType.USER_CHANGED_NAME, '🐒');
        }

        if (message.emoji || message.randomEmoji) {
            if (message.randomEmoji) {
                user.emoji = randomEmoji().emoji;
            } else {
                if (!hasEmoji(user.emoji)) {
                    this.emitNotice(socket, { type: 'error', message: 'Don\'t know nothing bout that "emoji".'})
                    return;
                }

                const foundEmoji = findEmoji(user.emoji).emoji;
                if (user.emoji === foundEmoji) {
                    this.emitNotice(socket, { type: 'error', message: `${user.emoji} is already taken. By you, you idiot.`})
                    return;
                }

                user.emoji = foundEmoji;
            }

            changed = true;
        }

        if (changed) {
            socket.emit('you', user.toPrivateData());
            this.emitUsers();
        }
    }

    public changeUserState(socket: Socket, state: { listening?: boolean, active?: boolean, typing ?: boolean }) {
        const user = this.findUser(socket);
        if (!user) return;

        let changed = false;
        Object.keys(state).forEach(key => {
            if (state[key] !== user.state[key]) {
                user.state[key] = state[key];
                changed = true;
            }
        })

        if (changed) {
            this.emitUsers();
        }
    }

    public updateLastActivity(socket: Socket) {
        const user = this.findUser(socket);
        if (!user) return;

        user.updateLastActivity();
        if (user.updateActive()) {
            this.emitUsers();
        }
    }


    protected isNameAvailable(name: string, excludePublicUserId?: string): boolean {
        return !this.users.find(
            user => user.name.toLowerCase() === name.toLowerCase() && user.publicId !== excludePublicUserId
        );
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

    private findSong(socket: Socket, key: string, emitNotice: boolean = true): Song|null {
        const song = this.songsQueue.get().find(s => s.key === key);
        if (!song && emitNotice) {
            this.emitNotice(socket, { type: 'error', message: `That song ain't in the queue.` });
        }
        return song;
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
        const user = this.findUser(socket);
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

        user.state.typing = false;
        this.emitUsers();
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
        console.log(message);
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
    activityCheck?: NodeJS.Timeout;

    static doUserCheck(users: ConnectedUser[], queue: ReactiveVar<Song[]>, currentSong: ReactiveVar<CurrentSong | null>, updateUsers: (users: ConnectedUser[]) => void) {
        const kickBefore = (new Date()).getTime() - TIME_TILL_KICK;

        // Don't kick any users that are (currently) DJing
        const djUserIds = queue.get().map(s => s.requestedBy);
        if (currentSong.get()?.song) {
            djUserIds.push(currentSong.get().song.requestedBy);
        }

        // Check if the list of filtered users is shorter
        const keepUsers = users.filter(user => !user.disconnectedSince || user.disconnectedSince > kickBefore || djUserIds.includes(user.publicId));
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

    /** Timestamp of last activity */
    lastActivity: number;

    state: {
        listening: boolean,
        typing: boolean,
        active: boolean,
    };

    constructor(
        socketId: string,
        public privateId: string,
        public publicId: string,
        public name: string,
        public emoji?: string,
    ) {
        this.socketId = socketId;
        this.admin = false;
        this.lastActivity = new Date().getTime();
        this.state = {
            listening: false,
            typing: false,
            active: true,
        }
    }

    public isConnected(): boolean {
        return !this.disconnectedSince && this.socketId !== undefined;
    }

    public updateLastActivity(time?: number) {
        this.lastActivity = time ? time : new Date().getTime();
    }

    public determineIsActive(): boolean {
        return this.lastActivity > (new Date().getTime() - TIME_TILL_INACTIVE);
    }

    /**
     * Update the active state of this user
     * @param active new active state
     * @return whether the state changed
     */
    public updateActive(active?: boolean): boolean {
        active = active === undefined ? this.determineIsActive() : active;

        if (this.state.active !== active) {
            this.state.active = active;
            return true;
        } else {
            return false;
        }
    }

    public toPublicData() {
        return {
            id: this.publicId,
            name: this.name,
            emoji: this.emoji,
            admin: this.admin,
            state: {
                connected: this.isConnected(),
                listening: this.state.listening,
                typing: this.state.typing,
                active: this.state.active,
            }
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


