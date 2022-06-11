import {Injectable, Logger} from "@nestjs/common";
import {ConfigService as NestConfigService} from "@nestjs/config";
import * as fs from "fs";

const CONFIG_DOWNLOAD_DIR = 'DOWNLOAD_DIR';
const CONFIG_ADMIN_PASSWORD = 'ADMIN_PASSWORD';
const CONFIG_YT_DLP_PATH = 'YT_DLP_PATH';
const CONFIG_AUDIOWAVEFORM_PATH = 'AUDIOWAVEFORM_PATH';
const CONFIG_SERVER_HOST = 'SERVER_HOST';
const CONFIG_SERVER_PORT = 'SERVER_PORT';

@Injectable()
export class ConfigService {

    private readonly logger: Logger;

    public readonly adminPassword: string;
    public readonly downloadDir: string;
    public readonly ytDlpPath: string;
    public readonly audiowaveformPath: string;

    public readonly serverHost: string;
    public readonly serverPort: number;

    constructor(private readonly configService: NestConfigService) {
        this.logger = new Logger(ConfigService.name);

        const errors: string[] = [];

        this.downloadDir = this.resolveDownloadDir(errors);
        this.ytDlpPath = this.resolveYtDlpPatth(errors);
        this.audiowaveformPath = this.resolveAudiowaveformPath(errors);
        this.adminPassword = this.resolveAdminPassword(errors);

        this.serverHost = this.resolveServerHost(errors);
        this.serverPort = this.resolveServerPort(errors);

        // Errors should be empty.
        if (errors.length > 0) {
            this.logger.error('Invalid ENV / config:')
            errors.forEach(error => this.logger.error(`=> ${error}`));
            throw new Error('Invalid ENV / config');
        }
    }

    private resolveServerHost(errors: string[]) {
        const host = this.configService.get<string>(CONFIG_SERVER_HOST);

        if (host) {
            this.logger.log(`Binding to host: ${host}`);
            return host;
        }

        const defaultHost = '0.0.0.0';
        this.logger.log(`Binding to host: ${defaultHost} (default for app)`);
        return defaultHost;
    }

    private resolveServerPort(errors: string[]) {
        const port = this.configService.get<number>(CONFIG_SERVER_PORT);
        if (port) {
            if (port >= 1 && port <= 65535) {
                this.logger.log(`Binding to port: ${port}`)
                return port;
            } else {
                errors.push(`Invalid port number: ${port}`)
                return 0;
            }
        }

        const defaultPort = 3555;
        this.logger.log(`Binding to port: ${defaultPort} (default for app)`)
        return defaultPort;
    }

    private resolveAdminPassword(errors: string[]) {
        const password = this.configService.get<string>(CONFIG_ADMIN_PASSWORD) ?? '';
        if (!password) {
            errors.push('ADMIN_PASSWORD ENV variable is missing');
        }
        return password;
    }

    private resolveDownloadDir(errors: string[]) {
        const downloadDir = this.configService.get<string>(CONFIG_DOWNLOAD_DIR) ?? '';
        if (!downloadDir) {
            errors.push('DOWNLOAD_DIR ENV variable is missing')
        } else if (!downloadDir.endsWith('/')) {
            errors.push('DOWNLOAD_DIR ENV variable should end with a /');
        } else if (!ConfigService.hasFsAccess(downloadDir, fs.constants.W_OK)) {
            errors.push('DOWNLOAD_DIR is not writable');
        }
        return downloadDir;
    }

    private resolveYtDlpPatth(errors: string[]) {
        const ytDlpPath = this.configService.get<string>(CONFIG_YT_DLP_PATH) ?? '';
        if (!ytDlpPath) {
            errors.push('YT_DLP_PATH ENV variable is missing');
        } else if (!ConfigService.hasFsAccess(ytDlpPath, fs.constants.X_OK)) {
            errors.push('YT_DLP_PATH is not executable');
        }
        return ytDlpPath;
    }

    private resolveAudiowaveformPath(errors: string[]): string {
        const path = this.configService.get<string>(CONFIG_AUDIOWAVEFORM_PATH) ?? '';
        if (!path) {
            errors.push('AUDIOWAVEFORM_PATH ENV variable is missing');
        } else if (!ConfigService.hasFsAccess(path, fs.constants.X_OK)) {
            errors.push('AUDIOWAVEFORM_PATH is not executable');
        }
        return path;
    }


    private static hasFsAccess(file: string, check: number): boolean {
        try {
            fs.accessSync(file, check);

            return true;
        } catch (e: any) {
            return false;
        }
    }


}
