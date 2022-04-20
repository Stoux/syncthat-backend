import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {SongsModule} from "./songs/songs.module";
import { RoomModule } from "./rooms/room.module";

@Module({
  imports: [
      ConfigModule.forRoot({
          envFilePath: [ '.env' ],
          isGlobal: true,
      }),
      SongsModule,
      RoomModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
