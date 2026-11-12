import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { controlJsonMiddleware } from './common/middleware/control-json.middleware';

async function bootstrap() {
  // Body parsing is disabled globally and applied conditionally below.
  // Object/part PUT bodies, including JSON objects, must reach the controller
  // as untouched streams. Only JSON control messages are parsed into req.body.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.use(controlJsonMiddleware);

  app.enableCors();

  // Registered before app.listen() so /docs is matched ahead of the
  // catch-all /:bucket routes (a bucket named "docs" would be shadowed).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Object Storage Service')
    .setDescription('S3-style bucket and object storage API')
    .setVersion('0.1.0')
    .addApiKey({ type: 'apiKey', name: 'Authorization', in: 'header', description: 'Signed Authorization header' }, 'signature')
    .setExternalDoc('Postman Collection', `http://localhost:${process.env.PORT || 3000}/docs-json`)
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig), {
    // Raw OpenAPI spec for importing into Postman: /docs-json and /docs-yaml
    jsonDocumentUrl: 'docs-json',
    yamlDocumentUrl: 'docs-yaml',
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Object storage system listening on port ${port}`);
}

bootstrap();
