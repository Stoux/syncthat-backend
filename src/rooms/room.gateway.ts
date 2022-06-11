import {
    ConnectedSocket,
    MessageBody,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from "@nestjs/websockets";
import { Socket, Server } from 'socket.io';
import {
    AddSong,
    BecomeAdmin,
    ChangeUser,
    ChangeSongQueuePosition,
    ChatMessage,
    Join,
    SkipToTimestamp,
    VoteOnCurrentSong
} from "./room.messages";
import {RoomHandler} from "./room.flow";
import {SongsService} from "../songs/songs.service";
import {ConfigService} from "../util/config.service";


@WebSocketGateway({
    path: '/rooms/ws',
    cors: {
        origin: '*',
    }
})
export class RoomGateway implements OnGatewayDisconnect, OnGatewayInit {

    @WebSocketServer()
    server: Server;

    rooms: { [id: number]: RoomHandler };
    socketToRoom: { [id: string]: number };


    constructor(
        private readonly songService: SongsService,
        private readonly configService: ConfigService,
    ) {
        this.rooms = {};
        this.socketToRoom = {};
    }

    handleDisconnect(client: Socket) {
        console.log('Disconnect?', client.id);
        this.disconnectFromRoom(client);
    }

    /**
     * Disconnect the user from the room (if any)
     * @param client
     * @private
     */
    private disconnectFromRoom(client: Socket) {
        const roomId = this.socketToRoom[client.id];
        if (!roomId) {
            return;
        }

        this.rooms[roomId].onDisconnect(client);
        delete this.socketToRoom[client.id];
    }

    @SubscribeMessage('join-room')
    async onJoinRoom(
        @ConnectedSocket() socket: Socket,
        @MessageBody() join: Join
    ) {
        this.withRoom(socket, join.room, room => {
            // Disconnect it from any other socket
            this.disconnectFromRoom(socket);

            if (room.join(socket, join)) {
                this.socketToRoom[socket.id] = room.roomId;
            }
        });
    }

    @SubscribeMessage('queue-song')
    async onQueueSong(
        @ConnectedSocket() socket: Socket,
        @MessageBody() request: AddSong,
    ) {
        this.withRoomFromSocket(socket, room => room.queueSong(socket, request));
    }

    @SubscribeMessage('remove-song-from-queue')
    async onRemoveQueueSong(
        @ConnectedSocket() socket: Socket,
        @MessageBody('key') key: string,
    ) {
        this.withRoomFromSocket(socket, room => room.removeSongFromQueue(socket, key));
    }

    @SubscribeMessage('force-play-from-queue')
    async onForcePlayFromQueue(
        @ConnectedSocket() socket: Socket,
        @MessageBody('key') key: string,
    ) {
        this.withRoomFromSocket(socket, room => room.forcePlaySongFromQueue(socket, key));
    }

    @SubscribeMessage('move-song-in-queue')
    async onMoveSongInQueue(
        @ConnectedSocket() socket: Socket,
        @MessageBody() message: ChangeSongQueuePosition,
    ) {
        this.withRoomFromSocket(socket, room => room.moveSongInQueue(socket, message.key, message.position));
    }

    @SubscribeMessage('skip-song')
    async onSkip(
        @ConnectedSocket() socket: Socket,
    ) {
        this.withRoomFromSocket(socket, room => room.skipSong(socket));
    }

    @SubscribeMessage('skip-to-timestamp')
    async onSkipToTimestamp(
        @ConnectedSocket() socket: Socket,
        @MessageBody() message: SkipToTimestamp
    ) {
        this.withRoomFromSocket(socket, room => room.skipSongToTimestamp(socket, message));
    }

    @SubscribeMessage('become-admin')
    async onBecomeAdmin(
        @ConnectedSocket() socket: Socket,
        @MessageBody() message: BecomeAdmin,
    ) {
        this.withRoomFromSocket(socket, room => room.becomeAdmin(socket, message.password));
    }

    @SubscribeMessage('send-chat-message')
    async onChatMessage(
        @ConnectedSocket() socket: Socket,
        @MessageBody() message: ChatMessage,
    ) {
        this.withRoomFromSocket(socket, room => room.onChatMessage( socket, message ));
    }

    @SubscribeMessage('vote-on-current-song')
    async onVote(
        @ConnectedSocket() socket: Socket,
        @MessageBody() message: VoteOnCurrentSong,
    ) {
        this.withRoomFromSocket(socket, room => room.onVote( socket, message ));
    }

    @SubscribeMessage('vote-skip-current-song')
    async onVoteSkip(
        @ConnectedSocket() socket: Socket,
    ) {
        this.withRoomFromSocket(socket, room => { /* TODO */ });
    }

    @SubscribeMessage('change-user')
    async onChangeUser(
        @ConnectedSocket() socket: Socket,
        @MessageBody() message: ChangeUser,
    ) {
        this.withRoomFromSocket(socket, room => room.changeCurrentUser( socket, message ));
    }

    private withRoomFromSocket(socket: Socket, handle: (room: RoomHandler) => void) {
        const room = this.socketToRoom[socket.id];
        this.withRoom(socket, room, handle);
    }

    private withRoom(socket: Socket, room: number, handle: (room: RoomHandler) => void) {
        // Check if it's a valid room
        if (!this.rooms[room]) {
            // Getouttaherewiththat
            socket.disconnect(true);
            return;
        }

        handle(this.rooms[room]);
    }



    afterInit(server: any): any {
        // Init our rooms
        this.rooms = {
            1: new RoomHandler(
                this.songService,
                this.configService,
                server,
                1
            )
        }
    }
}