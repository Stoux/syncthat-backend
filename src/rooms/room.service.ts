import { Injectable } from '@nestjs/common';

@Injectable()
export class RoomService {

  id: number;
//  users: User[];

  rooms: any[] = [
    {
      id: 1,
    }
  ]

  getRooms(): any {
    return this.rooms;
  }

  addUser(room:number): any {
    return true;
  }
}