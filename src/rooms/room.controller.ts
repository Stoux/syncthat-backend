import { Controller, Get } from '@nestjs/common';
import { RoomUser } from './room.models';
import {RoomService} from "./room.service";
import { Logger } from '@nestjs/common';

@Controller('rooms')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Get()
  getRooms(): string {
    return this.roomService.getRooms();
  }

  @Get('users')
  getUsers(): RoomUser[] {
    return this.roomService.getUsersForRoom(1);
  }

  @Get('/adduser')
  addUser(): void {
    const users = this.roomService.getUsersForRoom(1);

    var largest = 0;
    users.forEach(function(elem){
      if(largest < elem.id) {
        largest = elem.id;
      }
    });

    this.roomService.addUserToRoom(1, new RoomUser(largest+1 ,"Lorenzo"));
  }
}
