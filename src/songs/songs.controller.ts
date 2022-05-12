import {Body, Controller, Get, HttpException, HttpStatus, Param, Post, Req, Res, StreamableFile} from '@nestjs/common';
import {DownloadResult, SongsService} from "./songs.service";
import { ConfigService } from '@nestjs/config';
import {createReadStream, existsSync} from "fs";
import {Request, Response} from "express";
import * as fs from "fs";

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

    private readonly AUDIO_BUFFER_IN_BYTES = 1_000_000;

    @Get('stream/:key')
    getFile(@Res({ passthrough: true }) res: Response, @Req() request: Request, @Param('key') key: string) {
        const fileMatch = /^[\w-]+\.(mp3|json)$/.exec(key);
        if (!fileMatch) {
            throw new HttpException('Invalid file key given', HttpStatus.BAD_REQUEST);
        }

        const path = this.configService.get<string>('DOWNLOAD_DIR') + key;
        if (!fileMatch || !existsSync(path)) {
            throw new HttpException('File doesn\'t exist', HttpStatus.BAD_REQUEST);
        }

        const isMp3 = fileMatch[1] === 'mp3';
        if (!isMp3) {
            const file = createReadStream(path);
            return new StreamableFile(file);
        }


        const range = request.header('Range');
        let start = 0;
        let end = undefined;
        const rangeMatch = /^bytes=(\d+)-(\d+)?$/.exec(range ? range : '');
        if (rangeMatch) {
            start = parseInt(rangeMatch[1]);
            if (rangeMatch[2]) {
                end = parseInt(rangeMatch[2]);
            }
        }

        const stats = fs.statSync(path);
        if (end === undefined) {
            end = stats.size;
            if (end - start > this.AUDIO_BUFFER_IN_BYTES) {
                end = start + this.AUDIO_BUFFER_IN_BYTES;
            }
        }

        const file = createReadStream(path, { start, end });

        res.set({
            'Content-Type': 'audio/mpeg',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${stats.size}`,
            'Content-Length': (end - start),
        })

        res.status(206);

        return new StreamableFile(file);
    }

}