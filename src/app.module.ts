import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import {SongsModule} from "./songs/songs.module";
import { RoomModule } from "./rooms/room.module";
import {UtilModule} from "./util/util.module";

@Module({
  imports: [
      ConfigModule.forRoot({
          envFilePath: [ '.env' ],
          isGlobal: true,
      }),
      UtilModule,
      SongsModule,
      RoomModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
