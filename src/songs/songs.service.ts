import {HttpException, HttpStatus, Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {spawn, spawnSync} from 'child_process';

@Injectable()
export class SongsService {

    songs: {  [key: string]: DownloadResult };

    constructor(private configService: ConfigService) {
        this.songs = {};
    }

    downloadSong(url : string): DownloadResult {

        const dir = this.configService.get<string>('DOWNLOAD_DIR');
        const ytdlp = this.configService.get<string>('YT_DLP_PATH');

        const dumpJson = spawnSync(ytdlp, [ '--dump-json', '-q', url ]);
        if (dumpJson.error) {
            console.log(dumpJson.error, dumpJson.error);
            return new DownloadResult(
                false,
                undefined,
                undefined,
                -1
            );
        }


        const json = dumpJson.output.toString().replace(/^[\s,]*(\{.+\})[\s,]*$/, '$1');
        const info: YoutubeDlJsonDump = JSON.parse(json);
        const key = info.extractor + '-' + info.id;

        if (this.songs.hasOwnProperty(key)) {
            return this.songs[key];
        }

        this.songs[key] = new DownloadResult(
            true,
            info.id,
            info.extractor,
            0,
        )

        const download = spawn(ytdlp, ['-f', 'bestaudio/best', '-o', '%(extractor)s-%(id)s', url], {
            cwd: dir,
        });

        download.stdout.on('data', chunk => {
            let line = chunk.toString();
            const match = /\[download]\s+([\d.]+)% of.+/.exec(line);
            if (match) {
                this.songs[key].progress = parseFloat(match[1]);
                // TODO: Send websocket events
            }
        });

        download.on('exit', (code, signal) => {
            console.log('Finished download', code, signal);
            if (code === 0) {
                this.songs[key].progress = 100;
            } else {
                this.songs[key].progress = -1;
                this.songs[key].success = false;
            }
        });

        return this.songs[key];
    }

    getSongStatus(key: string): DownloadResult|null {
        return this.songs.hasOwnProperty(key) ? this.songs[key] : null;
    }


    getHello(): any {
        return {
            info: 'SyncThat backend!',
        };
    }
}

export class DownloadResult {
    success: boolean
    id?: string|number
    extractor?: string
    progress?: number
    key?: string;


    constructor(success: boolean, id: string | number, extractor: string, progress: number) {
        this.success = success;
        this.id = id;
        this.extractor = extractor;
        this.progress = progress;
        this.key = id ? extractor +'-' + id : null;
    }

}

interface YoutubeDlJsonDump {
    id: string,
    extractor: string,
}