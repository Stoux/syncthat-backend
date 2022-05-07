import {Body, Controller, Get, HttpException, HttpStatus, Param, Post, Res, StreamableFile} from '@nestjs/common';
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
    getFile(@Res({ passthrough: true }) res: Response, @Param('key') key: string) {
        const fileMatch = /^[\w-]+\.(mp3|json)$/.exec(key);
        if (!fileMatch) {
            throw new HttpException('Invalid file key given', HttpStatus.BAD_REQUEST);
        }

        const path = this.configService.get<string>('DOWNLOAD_DIR') + key;
        if (!fileMatch || !existsSync(path)) {
            throw new HttpException('File doesn\'t exist', HttpStatus.BAD_REQUEST);
        }

        const file = createReadStream(path);

        res.set({
            'Content-Type': fileMatch[1] === 'mp3' ? 'application/octet-stream' : 'application/json',
            'Accept-Ranges': 'bytes',
        })

        return new StreamableFile(file);
    }

}