import { Injectable } from '@nestjs/common';
import {Room, RoomUser, Song} from "./room.models";

@Injectable()
export class RoomService {

  rooms: Room[] = [
    new Room(1, 'ROOMPIE')
  ]

  getRooms(): any {
    return this.rooms;
  }

  getRoomById(roomId: number): Room|null {
    return this.rooms.find(room => room.id == roomId);
  }

  addUserToRoom(roomId: number, username: string) : RoomUser {
    const newUser = new RoomUser((Math.random() + 1).toString(36).substring(2), username);
    this.rooms.find(room => room.id == roomId).users.push(newUser);
    return newUser;
  }

  addSongToRoom(roomId: number, song:Song) : Song {
    const room = this.rooms.find(room => room.id == roomId);
    room.playlist.push(song);
    return song;
  }

  getUsersForRoom(roomId : number): RoomUser[] {
    return this.rooms.find(room => room.id == roomId).users;
  }

}