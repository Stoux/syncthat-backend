import { Module } from '@nestjs/common';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import {SongsModule} from "../songs/songs.module";
import {RoomGateway} from "./room.gateway";

@Module({
  imports: [SongsModule],
  controllers: [RoomController],
  providers: [RoomService, RoomGateway ],
})
export class RoomModule {}
