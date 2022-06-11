import { Module } from '@nestjs/common';
import {ConfigService} from "./config.service";
import {ConfigModule} from "@nestjs/config";

@Module({
  imports: [ConfigModule],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class UtilModule {}
