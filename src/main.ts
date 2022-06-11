import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {ConfigService} from "./util/config.service";

async function bootstrap() {
  // Build the app
  const app = await NestFactory.create(AppModule);

  // Allow all headers for CORS
  app.enableCors({ allowedHeaders: '*', origin: '*' })

  // Start the app
  const config = app.get(ConfigService);
  await app.listen(config.serverPort, config.serverHost);
}

bootstrap();
