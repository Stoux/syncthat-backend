import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {SongsController} from "./songs.controller";
import {SongsService} from "./songs.service";

@Module({
    imports: [
        ConfigModule,
    ],
    controllers: [ SongsController ],
    providers: [ SongsService ],
})
export class SongsModule {}
