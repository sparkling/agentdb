# Gemini AI Integration Setup

The advanced demo examples use Gemini AI for intelligent features like code generation, research synthesis, and content analysis. This document explains how to set up the AI integration.

## Current Status

⚠️ **AI Endpoint Status**: The demos are currently in **fallback mode** because the Gemini Edge Function needs to be deployed.

## What Works Without AI Service

All demos include fully functional features that work entirely in your browser:

- ✅ **AgentDB WASM**: Full vector database functionality
- ✅ **Pattern Learning**: Local machine learning from your usage
- ✅ **Semantic Search**: Vector-based similarity matching
- ✅ **Knowledge Graphs**: Topic relationship mapping
- ✅ **Preference Learning**: Adaptive content curation

## What Requires AI Service

These features need the Gemini Edge Function deployed:

- 🤖 **AI Code Generation** (Intelligent Code Assistant)
- 🔬 **Research Synthesis** (Autonomous Research Assistant)
- 🏷️ **Auto-Tagging** (Personal Knowledge Manager)
- 📝 **Meeting Summarization** (Smart Meeting Notes)
- 🎯 **Content Analysis** (Adaptive Content Curator)

## Setup Instructions

### Option 1: Deploy to Supabase (Recommended)

1. **Install Supabase CLI**:
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase**:
   ```bash
   supabase login
   ```

3. **Link your project**:
   ```bash
   supabase link --project-ref yoyrnfdeqygvfpmhjwty
   ```

4. **Set up Gemini API Key**:
   - Get a Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Add it as a secret:
     ```bash
     supabase secrets set GEMINI_API_KEY=your-key-here
     ```

5. **Deploy the Edge Function**:
   ```bash
   supabase functions deploy agentdb-ai
   ```

### Option 2: Use Your Own AI Endpoint

Update the endpoint URL in each demo file:

```javascript
// Change this line in each demo
const AI_ENDPOINT = 'YOUR_ENDPOINT_URL_HERE';
```

Your endpoint should accept POST requests with this format:

```json
{
  "type": "generate|research|summarize|tag|optimize",
  "code": "system prompt",
  "context": "user input",
  "model": "google/gemini-2.0-flash-exp"
}
```

And return:

```json
{
  "response": "AI generated response text"
}
```

### Option 3: Use Mock Mode (Current Default)

The demos automatically fall back to mock responses when the AI service is unavailable. This is perfect for:

- Testing the UI/UX
- Demonstrating the workflow
- Learning the AgentDB features
- Development without API costs

## Testing the Integration

After deployment, test each demo:

1. **Intelligent Code Assistant**: Try generating code
2. **Autonomous Research**: Submit a research query
3. **Personal Knowledge Manager**: Use auto-tagging
4. **Smart Meeting Notes**: Analyze a transcript
5. **Adaptive Content Curator**: Check AI recommendations

## Troubleshooting

### 500 Error from AI Endpoint

- ✅ Verify Gemini API key is set correctly
- ✅ Check Edge Function logs: `supabase functions logs agentdb-ai`
- ✅ Ensure API key has proper permissions
- ✅ Verify billing is enabled on Google AI

### CORS Errors

Add CORS headers to your Edge Function:

```typescript
return new Response(JSON.stringify(result), {
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
});
```

### Rate Limiting

Gemini API has rate limits. Consider:

- Caching responses in AgentDB
- Implementing request queuing
- Using exponential backoff
- Upgrading to paid tier

## Cost Considerations

The Gemini Flash model is very affordable:

- **Input**: ~$0.075 per 1M tokens
- **Output**: ~$0.30 per 1M tokens
- **Context**: 1M token context window

For typical usage in these demos:
- Code generation: ~500-2000 tokens per request
- Research synthesis: ~1000-3000 tokens per request
- Estimated cost: **< $0.01 per 100 requests**

## Demo Capabilities Without AI

Even without the AI service, the demos showcase:

| Feature | Works Offline | Requires AI |
|---------|--------------|-------------|
| Vector Search | ✅ | - |
| Pattern Learning | ✅ | - |
| Knowledge Graphs | ✅ | - |
| Preference Tracking | ✅ | - |
| Semantic Matching | ✅ | - |
| Code Generation | ⚠️ Demo mode | ✅ Full |
| Research Synthesis | ⚠️ Demo mode | ✅ Full |
| Auto-Tagging | ⚠️ Demo mode | ✅ Full |
| Summarization | ⚠️ Demo mode | ✅ Full |

## Next Steps

1. **Try the demos** in fallback mode to see the UX
2. **Deploy the Edge Function** for full AI features
3. **Customize the prompts** for your use case
4. **Add more examples** using the same pattern

## Support

- **Edge Function Code**: `/supabase/functions/agentdb-ai/`
- **Demo Files**: `/public/agentdb/examples/browser/`
- **Issues**: Report on GitHub

---

**Note**: The demos are designed to work beautifully even without AI, showcasing AgentDB's powerful browser-based ML capabilities!
