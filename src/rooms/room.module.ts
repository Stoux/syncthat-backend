import { Module } from '@nestjs/common';
import { RoomService } from './room.service';
import {SongsModule} from "../songs/songs.module";
import {RoomGateway} from "./room.gateway";
import {UtilModule} from "../util/util.module";

@Module({
  imports: [SongsModule, UtilModule],
  controllers: [ /* RoomController */ ],
  providers: [RoomService, RoomGateway ],
})
export class RoomModule {}
