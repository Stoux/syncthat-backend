import { Controller, Get } from '@nestjs/common';
import {RoomService} from "./room.service";

@Controller('rooms')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Get()
  getHello(): string {
    return this.roomService.getRooms();
  }
}
