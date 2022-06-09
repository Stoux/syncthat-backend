import {HttpException, HttpStatus, Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {spawn, spawnSync} from 'child_process';
import * as fs from "fs";

@Injectable()
export class SongsService {

    songs: {  [key: string]: DownloadResult };

    constructor(private configService: ConfigService) {
        this.songs = {};
    }

    downloadSong(
        url : string,
        progressCallback?: (result: DownloadResult) => void,
    ): DownloadResult {

        const dir = this.configService.get<string>('DOWNLOAD_DIR');
        const ytdlp = this.configService.get<string>('YT_DLP_PATH');

        const dumpJson = spawnSync(ytdlp, [ '--dump-json', '-q', url ]);
        if (dumpJson.error) {
            console.log(dumpJson.error, dumpJson.error);
            return new DownloadResult(
                undefined,
                undefined,
                DownloadResult.PROGRESS_FAILED,
            );
        }

        // Parse the key & data
        const json = dumpJson.output.toString().replace(/^[\s,]*(\{.+\})[\s,]*$/, '$1');
        const info: YoutubeDlJsonDump = JSON.parse(json);
        const key = info.extractor + '-' + info.id;

        // Check if we're already downloading the song / have already downloaded the song
        if (this.songs.hasOwnProperty(key)) {
            const foundSong = this.songs[key];
            if (foundSong.isDownloading() && progressCallback) {
                // Still downloading
                foundSong.subscribeToProgress(progressCallback);
            }

            return foundSong;
        }

        const result = new DownloadResult(
            info.id,
            info.extractor,
            0,
            {
                id: info.id,
                title: info.title,
                uploader: info.uploader,
                thumbnail: info.thumbnail,
                extractor: info.extractor,
                uploader_url: info.uploader_url,
                webpage_url: info.webpage_url,
                description: info.description,
                duration_string: info.duration_string,
            }
        );
        this.songs[key] = result

        result.duration = SongsService.parseDurationString(info.duration_string);
        result.title = info.title;

        if (fs.existsSync(`${dir}/${result.key}.mp3`)) {
            console.log('File already downloaded');
            result.setProgress(DownloadResult.PROGRESS_SUCCESS);

            if (fs.existsSync(`${dir}/${result.key}.json`)) {
                result.waveformGenerated = true;
            } else {
                if (progressCallback) {
                    result.subscribeToProgress(progressCallback);
                }

                this.drawWaveForm(result);
            }

            return result;
        }

        // Add progress listener
        if (progressCallback) {
            result.subscribeToProgress(progressCallback);
        }


        // Start download task
        const download = spawn(ytdlp, ['--extract-audio', '--audio-format', 'mp3', '-o', '%(extractor)s-%(id)s.mp3', url], {
            cwd: dir,
        });

        download.stdout.on('data', chunk => {
            let line = chunk.toString();
            const match = /\[download]\s+([\d.]+)% of.+/.exec(line);
            if (match) {
                result.setProgress(parseFloat(match[1]));
            }
        });

        download.stderr.on('data', chunk => {
            console.log(chunk.toString());
        });

        download.on('exit', (code, signal) => {
            console.log('Finished download', code, signal);
            result.setProgress(code === 0 ? DownloadResult.PROGRESS_SUCCESS : DownloadResult.PROGRESS_FAILED);
            if(code === 0){
                this.drawWaveForm(result);
            }
        });

        return result;
    }

    drawWaveForm(result: DownloadResult): boolean{
        const audiowaveform = this.configService.get<string>('AUDIOWAVEFORM_PATH');
        const dir = this.configService.get<string>('DOWNLOAD_DIR');

        // Start geenratingtask
        const generateWaveform = spawn(audiowaveform, ['-i' ,result.key + '.mp3', '-o', result.key+".json"], {
            cwd: dir,
        });

        generateWaveform.on('exit', code => {
            if(code ===  0){
                result.waveformGenerated = true;
                result.setProgress(DownloadResult.PROGRESS_SUCCESS);
            }
        })
        return true;
    }



    private static parseDurationString(duration: string): number {
        const split = /(?:(?:(\d+):)?(\d+):)?(\d+)$/.exec(duration);
        if (!split) {
            return 0;
        }

        const hours = split[1] ? parseInt(split[1]) : 0;
        const mins = split[2] ? parseInt(split[2]) : 0;
        const secs = split[3] ? parseInt(split[3]) : 0;

        return ((hours * 60 * 60) + (mins * 60) + secs);
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

    static readonly PROGRESS_FAILED = -1;
    static readonly PROGRESS_SUCCESS = 100;

    success: boolean|undefined
    id?: string|number
    extractor?: string
    duration?: number
    songInfo: YoutubeDlJsonDump;
    title?: string;
    progress?: number
    key?: string;
    waveformGenerated?: boolean;
    private callbacks: ((result: DownloadResult) => void)[];


    constructor(id: string | number, extractor: string, progress?: number, songInfo?: YoutubeDlJsonDump) {
        this.id = id;
        this.extractor = extractor;
        this.key = id ? extractor +'-' + id : null;
        this.callbacks = [];
        this.songInfo = songInfo;
        this.setProgress(progress);
    }

    /**
     * Is currently being downloaded.
     */
    public isDownloading(): boolean {
        return this.progress >= 0 && this.progress < 100;
    }

    public setProgress(progress: number) {
        this.progress = progress;
        if (progress === DownloadResult.PROGRESS_FAILED) {
            this.success = false;
        } else if (progress === DownloadResult.PROGRESS_SUCCESS) {
            this.success = true;
        } else if (progress !== undefined && (progress < 0 || progress > DownloadResult.PROGRESS_SUCCESS)) {
            throw 'Invalid progress amount';
        }

        this.callbacks.forEach(c => c(this));
    }

    public subscribeToProgress(callback: (result: DownloadResult) => void) {
        this.callbacks.push(callback);
    }

    public unsubscribeFromProgress(callback: (result: DownloadResult) => void) {
        this.callbacks = this.callbacks.filter(c => c !== callback);
    }

}

export interface YoutubeDlJsonDump {
    id: string,
    extractor: string,
    duration_string: string,
    title: string,
    description?: string,
    webpage_url?: string,
    uploader?: string,
    uploader_url?: string,
    thumbnail?: string,
}