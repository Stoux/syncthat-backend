import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {RoomModule} from "./rooms/room.module";
import {UserModule} from "./users/user.module";

@Module({
  imports: [RoomModule, UserModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
