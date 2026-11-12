import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  // Body parsing is disabled globally and applied conditionally below.
  // Object PUT/GET bodies are raw bytes (no content-type, or
  // application/octet-stream) and need to reach ObjectsController as an
  // untouched stream; only JSON requests (bucket config, tagging, auth)
  // should be parsed into req.body.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      express.json({ limit: '10mb' })(req, res, next);
    } else {
      next();
    }
  });

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
