import type { Hono } from 'hono';

const OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Sheka API',
    version: '1.0.0',
    description:
      'On-chain 3-way (home/draw/away) parimutuel sports prediction markets with paid, ' +
      'model-selectable, Seal-encrypted AI analysis.',
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Session token from POST /api/auth/verify.',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { status: { type: 'string' } } },
              },
            },
          },
          '503': {
            description: 'Unhealthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { status: { type: 'string' }, error: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    '/api/sports': {
      get: {
        summary: 'Available sports from ESPN',
        responses: { '200': { description: 'Sports' } },
      },
    },
    '/api/games': {
      get: {
        summary: 'Live / upcoming / final games from ESPN',
        parameters: [{ name: 'sport', in: 'query', schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Games' },
          '503': { description: 'ESPN unavailable' },
        },
      },
    },
    '/api/auth/nonce': {
      get: {
        summary: 'Request a nonce to sign for wallet auth',
        parameters: [{ name: 'address', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Nonce + expiry' } },
      },
    },
    '/api/auth/verify': {
      post: {
        summary: 'Verify a signed nonce → issue a session token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['address', 'nonce', 'signature'],
                properties: {
                  address: { type: 'string' },
                  nonce: { type: 'string' },
                  signature: { type: 'string' },
                  zk_proof: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'session_token, wallet_address, expires_at' },
          '401': { description: 'Invalid signature/nonce' },
        },
      },
    },
    '/api/markets': {
      get: {
        summary:
          'List prediction markets with live on-chain pools + implied odds (%) + scheduled_at (kickoff)',
        responses: {
          '200': {
            description: 'Markets (each: pools, total, implied_odds, status, scheduled_at)',
          },
        },
      },
    },
    '/api/markets/{id}/resolve-auto': {
      post: {
        summary: 'Operator: auto-resolve from the ESPN final score',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Resolved' },
          '404': { description: 'Market not found' },
          '409': { description: 'Game not final yet' },
        },
      },
    },
    '/api/markets/{id}/analyze': {
      post: {
        summary:
          'Paid/free AI analysis of a market (verifies on-chain access, Seal-encrypts result)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['model_id', 'access_tx_digest'],
                properties: {
                  model_id: { type: 'integer', description: 'Model id from GET /api/models' },
                  access_tx_digest: {
                    type: 'string',
                    description: 'Digest of the on-chain purchase or claim_free tx',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Analysis result (recommendation + Seal/Walrus refs), or a skip message',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    model: { type: 'string' },
                    receipt_id: { type: 'string' },
                    blob_id: {
                      type: 'string',
                      nullable: true,
                      description: 'Walrus blob id of the Seal-encrypted analysis',
                    },
                    recommendation: {
                      type: 'object',
                      properties: {
                        outcome: { type: 'integer', description: '0 home, 1 draw, 2 away' },
                        label: { type: 'string' },
                        edge: { type: 'number', description: 'Kelly edge, %' },
                        has_edge: { type: 'boolean' },
                        model_probs: {
                          type: 'array',
                          items: { type: 'number' },
                          description: '[home, draw, away] %',
                        },
                        implied_prob: { type: 'number' },
                        confidence_tier: { type: 'string', enum: ['low', 'medium', 'high'] },
                        reasoning: { type: 'string' },
                      },
                    },
                    skip: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          '401': { description: 'Wallet not authenticated' },
          '402': { description: 'On-chain access verification failed' },
          '409': { description: 'This access was already consumed' },
        },
      },
    },
    '/api/models': {
      get: {
        summary: 'AI model catalog (id, label, price, free flag) for the analyze dropdown',
        responses: { '200': { description: 'Models' } },
      },
    },
    '/api/analysis/quota': {
      get: {
        summary: "Caller's remaining free analyses (on-chain quota)",
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'free_used, free_limit, free_remaining' },
          '401': { description: 'Wallet not authenticated' },
        },
      },
    },
    '/api/analysis/mine': {
      get: {
        summary:
          'Analyses this wallet owns (Seal/Walrus refs to decrypt; plaintext stays owner-only)',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'analyses: [{ market_id, receipt_id, blob_id, model_id }]' },
          '401': { description: 'Wallet not authenticated' },
        },
      },
    },
  },
};

export function createOpenAPIRouter(app: Hono) {
  app.get('/openapi.json', (c) => {
    return c.json(OPENAPI_SPEC);
  });

  app.get('/docs', (c) => {
    return c.html(`<!doctype html>
<html>
  <head>
    <title>Sheka API Docs</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="https://scalar.com/favicon.svg">
    <link rel="icon alternate" href="https://scalar.com/favicon.png">
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/openapi.json"
      data-proxy-url=""
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`);
  });
}
