import { Module } from '@nestjs/common';
import {SongsController} from "./songs.controller";
import {SongsService} from "./songs.service";
import {UtilModule} from "../util/util.module";

@Module({
    imports: [ UtilModule ],
    controllers: [ SongsController ],
    providers: [ SongsService ],
    exports: [
        SongsService,
    ]
})
export class SongsModule {}
