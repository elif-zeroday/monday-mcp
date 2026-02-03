import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config, validateConfig } from './config';
import { logger } from './logger';
import { handleWebhookEvent } from './webhook-handler';

// Validate configuration on startup
validateConfig();

const app = express();

// Parse JSON body with raw body for signature verification
app.use(express.json({
  verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
    req.rawBody = buf;
  },
}));

/**
 * Generate a unique request ID for tracking
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Optional: Verify webhook signature (if WEBHOOK_SIGNING_SECRET is set)
 */
function verifySignature(req: Request & { rawBody?: Buffer }): boolean {
  if (!config.webhookSigningSecret) {
    return true; // Skip verification if no secret configured
  }
  
  const signature = req.headers['x-monday-signature'];
  if (!signature || typeof signature !== 'string') {
    return false;
  }
  
  const computedSignature = crypto
    .createHmac('sha256', config.webhookSigningSecret)
    .update(req.rawBody || '')
    .digest('base64');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computedSignature)
  );
}

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    dryRun: config.dryRun,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Main webhook endpoint
 */
app.post('/webhook', async (req: Request & { rawBody?: Buffer }, res: Response) => {
  const requestId = generateRequestId();
  
  logger.info('Incoming webhook request', {
    requestId,
    contentType: req.headers['content-type'],
    hasSignature: !!req.headers['x-monday-signature'],
  });
  
  // Verify signature if secret is configured
  if (!verifySignature(req)) {
    logger.warn('Invalid webhook signature', { requestId });
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }
  
  try {
    const result = await handleWebhookEvent(req.body, requestId);
    
    // For challenge responses, return the challenge
    if (result.challenge) {
      res.json({ challenge: result.challenge });
      return;
    }
    
    res.json(result);
  } catch (error) {
    logger.error('Error processing webhook', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      requestId,
    });
  }
});

/**
 * Catch-all error handler
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
  logger.info(`Server started`, {
    port: config.port,
    dryRun: config.dryRun,
    subitemBoard: config.boards.subitem,
    featureBoard: config.boards.feature,
    mainBoard: config.boards.main,
  });
  
  if (config.dryRun) {
    logger.warn('DRY-RUN MODE ENABLED - No changes will be applied');
  }
});
