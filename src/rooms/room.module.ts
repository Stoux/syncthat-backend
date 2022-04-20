import { Module } from '@nestjs/common';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import {SongsModule} from "../songs/songs.module";

@Module({
  imports: [SongsModule],
  controllers: [RoomController],
  providers: [RoomService],
})
export class RoomModule {}
