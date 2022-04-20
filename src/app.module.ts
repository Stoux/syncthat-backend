import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {SongsModule} from "./songs/songs.module";

@Module({
  imports: [
      ConfigModule.forRoot({
          envFilePath: [ '.env' ],
          isGlobal: true,
      }),
      SongsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
