export default () => ({
  port: parseInt(process.env.PORT || "3000", 10),
  database: {
    dialect: process.env.DB_DIALECT || "postgres",
    storage: process.env.DB_STORAGE || "./data/metadata.sqlite",
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
    username: process.env.DB_USERNAME || "postgres",
    password: process.env.DB_PASSWORD || "root",
    database: process.env.DB_NAME || "object_storage",
  },
  storage: {
    adapter: process.env.STORAGE_ADAPTER || "local",
    localRoot: process.env.STORAGE_LOCAL_ROOT || "./data/blobs",
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      region: process.env.S3_REGION || "us-east-1",
    },
  },
  security: {
    requestSigningSecret:
      process.env.REQUEST_SIGNING_SECRET || "dev-signing-secret-change-me",
    encryptionMasterKey:
      process.env.ENCRYPTION_MASTER_KEY || "dev-32-byte-minimum-master-key!!",
    presignedUrlSecret:
      process.env.PRESIGNED_URL_SECRET || "dev-presigned-secret-change-me",
  },
});
