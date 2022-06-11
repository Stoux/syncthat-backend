import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Build the app
  const app = await NestFactory.create(AppModule);

  // Allow all headers for CORS
  app.enableCors({ allowedHeaders: '*', origin: '*' })

  // Start the app
  await app.listen(3555, '0.0.0.0');
}

bootstrap();
