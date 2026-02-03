import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Monday.com API configuration
  mondayToken: process.env.MONDAY_TOKEN || '',
  mondayApiUrl: 'https://api.monday.com/v2',
  
  // Webhook configuration
  webhookSigningSecret: process.env.WEBHOOK_SIGNING_SECRET || '',
  
  // Server configuration
  port: parseInt(process.env.PORT || '3001', 10),
  
  // Dry-run mode
  dryRun: process.env.DRY_RUN === 'true',
  
  // Board IDs (verified)
  boards: {
    subitem: 18041802160,        // Subitems of P2S Feature Board
    feature: 18041801957,        // P2S Feature Board (parent board)
    main: 18012438587,           // Main Agile Board
  },
  
  // Column IDs (verified)
  columns: {
    // Subitem -> Main relation column on subitem board
    subitemToMain: 'board_relation_mkw4vrjt',  // "İlgili Task"
    
    // Main -> Feature relation column on main board
    mainToFeature: 'board_relation_mkw8vvdh',  // "İlgili Epic"
  },
  
  // Retry configuration
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
  },
} as const;

// Validate required configuration
export function validateConfig(): void {
  if (!config.mondayToken) {
    throw new Error('MONDAY_TOKEN environment variable is required');
  }
}
