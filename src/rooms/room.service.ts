import { Injectable } from '@nestjs/common';
import {Room, RoomUser} from "./room.models";

@Injectable()
export class RoomService {

  rooms: Room[] = [
    new Room(1, 'ROOMPIE')
  ]

  getRooms(): any {
    return this.rooms;
  }

  addUserToRoom(roomId: number, user: RoomUser) {
    this.rooms[0].users.push(user);
  }

  getUsersForRoom(roomNumber : number): RoomUser[] {
    return this.rooms[0].users;
    return this.rooms.find(room => room.id === roomNumber).users;
  }

}