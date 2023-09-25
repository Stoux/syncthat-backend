import {Injectable} from '@nestjs/common';
import {spawn, spawnSync} from 'child_process';
import * as fs from "fs";
import {ConfigService} from "../util/config.service";
import * as crypto from "crypto";
import { basename } from 'path';
import { get as httpGet } from 'https';
import {parseFile} from "music-metadata";
import {existsSync} from "fs";

@Injectable()
export class SongsService {

    songs: {  [key: string]: DownloadResult };

    constructor(private configService: ConfigService) {
        this.songs = {};
    }

    async downloadSong(
        url : string,
        progressCallback?: (result: DownloadResult) => void,
    ): Promise<DownloadResult> {

        const dir = this.configService.downloadDir;
        const ytdlp = this.configService.ytDlpPath;

        // Might be a direct link to an MP3
        if (url.toLowerCase().endsWith('.mp3')) {
            // Attempt to direct download it.
            return await this.downloadMp3(url, progressCallback);
        }

        let info: YoutubeDlJsonDump;
        try {
            // Attempt to fetch the details using YT-DL
            info = await this.fetchYtDlJsonMetaData(url);
        } catch(e) {
            // Failed: early abort.
            console.error(`[${url}] Meta fetch failed:`, e);
            return new DownloadResult(
                undefined,
                undefined,
                DownloadResult.PROGRESS_FAILED,
            );
        }

        const key = info.extractor + '-' + info.id;

        // Check if we're already downloading the song
        let foundSong = this.checkIfAlreadyDownloading(key, progressCallback);
        if (foundSong) {
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

        if (this.checkIfAlreadyDownloaded(dir, result, progressCallback)) {
            return result;
        }

        // Add progress listener
        if (progressCallback) {
            result.subscribeToProgress(progressCallback);
        }

        // Start download task
        const download = spawn(ytdlp, ['--extract-audio', '--no-warnings', '--no-playlist', '--audio-format', 'mp3', '-o', '%(extractor)s-%(id)s.mp3', url], {
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

    private async fetchYtDlJsonMetaData(url: string): Promise<YoutubeDlJsonDump> {
        // Fetch the dump data
        const jsonOutput = await new Promise<string>((resolve, reject) => {
            let jsonOutput = '';

            const dumpJsonProcess = spawn(this.configService.ytDlpPath, ['--dump-json', '--no-playlist', '--no-warnings', '-q', url]);

            dumpJsonProcess.stdout.setEncoding('utf-8');
            dumpJsonProcess.stdout.on('data', data => {
                jsonOutput += data.toString();
            });
            dumpJsonProcess.stderr.on('data', data => {
                console.error(`[${url}] ${data.toString()}`);
            });
            dumpJsonProcess.on('exit', code => {
                if (code === 0) {
                    resolve(jsonOutput);
                } else {
                    reject('Invalid code: ' + code);
                }
            })
        });

        // Parse the key & data
        const json = jsonOutput.replace(/^[\s,]*(\{.+\})[\s,]*$/, '$1');
        const info: YoutubeDlJsonDump = JSON.parse(json);

        return info;

        // // Might be a direct link to an MP3
        // if (url.toLowerCase().endsWith('.mp3')) {
        //     directOrFailedResult = this.downloadMp3(url, progressCallback);
        // }
    }

    private readonly EXTRACTOR_DIRECT = 'direct';

    private async downloadMp3(url: string, progressCallback: (result: DownloadResult) => void): Promise<DownloadResult> {
        try {
            // Check if the file exists
            const exists = (await fetch(url, { method: 'HEAD' })).ok;
            if (!exists) {
                throw `[${url}] Bad response from HTTP server`;
            }


            // Create a hash of the URL as ID
            const sha1 = crypto.createHash('sha1')
            sha1.update(url);
            const id = sha1.digest('hex');
            const key = this.EXTRACTOR_DIRECT + '-' + id;

            // Check if already downloading
            const foundSong = this.checkIfAlreadyDownloading(key, progressCallback);
            if (foundSong) {
                return foundSong;
            }

            // Create a download result for this song
            const urlInfo = new URL(url);
            const result = new DownloadResult(
                id,
                this.EXTRACTOR_DIRECT,
                0,
                {
                    id: id,
                    extractor: this.EXTRACTOR_DIRECT,
                    duration_string: '?',
                    title: basename(urlInfo.pathname),
                    uploader: urlInfo.hostname,
                    description: 'Direct download from ' + url,
                    webpage_url: url,
                },
            );

            this.songs[id] = result;

            // Check if the file is already downloaded
            const filePath = this.configService.downloadDir + '/' + key + '.mp3';
            if (existsSync(filePath)) {
                // Fetch the MP3 data for the file
                await this.setLocalMp3Meta(filePath, result);
                if (!result.duration) {
                    throw 'Failed to detect duration in file';
                }

                // This should always return true at this point
                if (this.checkIfAlreadyDownloaded(this.configService.downloadDir, result, progressCallback)) {
                    return result;
                }
            }


            // Add the progress listener
            if (progressCallback) {
                result.subscribeToProgress(progressCallback);
            }

            // Start download task
            const file = fs.createWriteStream(filePath);
            const failDownload = () => {
                result.setProgress(DownloadResult.PROGRESS_FAILED)
                file.close();
                fs.unlinkSync(filePath);
            };

            httpGet(url, (response) => {
                // Early abort
                if (!(response.statusCode >= 200 && response.statusCode < 300)) {
                    result.setProgress(DownloadResult.PROGRESS_SUCCESS)
                    file.close();
                    return;
                }

                // Pipe the response to the file
                response.pipe(file);

                // Check the totalLength for the progress
                const totalLength = parseInt(response.headers['content-length'], 10);
                let totalDownloaded = 0;
                response.on('data', chunk => {
                    // Calculate the progress
                    totalDownloaded += chunk.length;
                    const progress = Math.floor((totalDownloaded / totalLength) * 100.0);

                    // Only update if the progress is different from the previous update & less than 100 (as we need to some additional parsing when finished)
                    if (progress !== result.progress && progress < DownloadResult.PROGRESS_SUCCESS) {
                        result.setProgress(progress);
                    }
                });

                // Add finish/start listeners
                response.on("end", async () => {
                    console.log('Finished');
                    file.close();

                    // Parse the downloaded MP3 for additional data
                    try {
                        await this.setLocalMp3Meta(filePath, result);
                        if (!result.duration) {
                            throw 'Failed to detect duration in file';
                        }

                        // Finish the download
                        result.setProgress(DownloadResult.PROGRESS_SUCCESS)
                    } catch(e ) {
                        failDownload();
                        console.error(`[${url}] Failed meta data:`, e);
                    }
                });
                response.on('error', () => failDownload());
            });

            return result;
        } catch( e ) {
            console.error(`[${url}] Failed:`, e);
            return undefined;
        }
    }

    private async setLocalMp3Meta(filePath: string, result: DownloadResult) {
        console.log('Parsing meta data of file:', filePath);
        const meta = await parseFile(filePath, {duration: true});
        console.log('Parsed meta', meta);

        // Duration is required
        result.duration = meta.format.duration;
        result.songInfo.title = result.title = meta.common.title ?? result.title;
        result.songInfo.uploader = meta.common.artist;
    }

    private checkIfAlreadyDownloading(key: string, progressCallback: (result: DownloadResult) => void): DownloadResult|undefined {
        if (!this.songs.hasOwnProperty(key)) {
            return undefined;
        }

        const foundSong = this.songs[key];
        if (foundSong.isDownloading() && progressCallback) {
            // Still downloading
            foundSong.subscribeToProgress(progressCallback);
        }

        return foundSong;
    }

    private checkIfAlreadyDownloaded(dir: string, result: DownloadResult, progressCallback: (result: DownloadResult) => void) {
        let shouldReturn = false;
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

            shouldReturn = true;
        }
        return shouldReturn;
    }

    drawWaveForm(result: DownloadResult): boolean{
        const audiowaveform = this.configService.audiowaveformPath;
        const dir = this.configService.downloadDir;

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
        this.title = songInfo?.title;
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
