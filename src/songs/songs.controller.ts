import {Body, Controller, Get, HttpException, HttpStatus, Param, Post, Res} from '@nestjs/common';
import {DownloadResult, SongsService} from "./songs.service";
import { ConfigService } from '@nestjs/config';
import {createReadStream, existsSync} from "fs";
import {Response} from "express";

@Controller('songs')
export class SongsController {

    constructor(
        private readonly songsService: SongsService,
        private readonly configService: ConfigService,
    ) {}

    @Post('download')
    downloadSong(@Body('url') url: string): any {

        return {
            yes: 'hi',
            url: this.songsService.downloadSong(url),
        };
    }

    @Get('status/:key')
    getSongStatus(@Param('key') key: string): DownloadResult|null {
        return this.songsService.getSongStatus(key);
    }

    @Get('stream/:key')
    getFile(@Res() res: Response, @Param('key') key: string) {
        const path = this.configService.get<string>('DOWNLOAD_DIR') + key;
        if (!existsSync(path)) {
            throw new HttpException('File doesn\'t exist', HttpStatus.BAD_REQUEST);
        }

        const file = createReadStream(path);
        file.pipe(res);
    }

}