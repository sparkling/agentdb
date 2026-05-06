import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Wand2,
  Database,
  Zap,
  Code,
  Eye,
  Copy,
  ChevronRight,
  ChevronLeft,
  Check,
  Sparkles,
  Download,
  Gauge,
  MemoryStick,
  Clock
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface WizardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface WizardConfig {
  // Step 1: Database
  backend: 'wasm' | 'native';
  memoryMode: boolean;
  dimensions: number;

  // Step 2: Example Type & Configuration
  exampleType: 'simple' | 'rag' | 'semantic-search' | 'learning' | 'clustering' | 'anomaly-detection' | 'text-classification' | 'recommendation-system' | 'ecommerce-search' | 'customer-support' | 'fraud-detection' | 'code-search' | 'sentiment-analysis' | 'duplicate-detection';
  includeUI: boolean;
  includeVisualization: boolean;

  // Per-Example Configuration
  numCategories: number;
  similarityThreshold: number;
  enableRealtime: boolean;
  maxResults: number;
  deploymentTarget: 'browser' | 'node' | 'edge-worker' | 'cloudflare';

  // Step 3: Advanced Configuration
  // Search & Index
  enableHNSW: boolean;
  M: number;
  efConstruction: number;
  efSearch: number;
  distanceMetric: 'cosine' | 'euclidean' | 'dot';
  maxM0: number;
  enableCache: boolean;
  cacheSize: number;
  batchSize: number;

  // Swarm & Coordination
  enableSwarm: boolean;
  swarmTopology: 'mesh' | 'hierarchical' | 'ring' | 'star';
  maxAgents: number;

  // Hive Mind / Distributed
  enableHiveMind: boolean;
  consensusProtocol: 'raft' | 'gossip' | 'byzantine';
  replicationFactor: number;

  // Code Generation
  enableCodeGen: boolean;
  codeStyle: 'typescript' | 'javascript' | 'python';
  includeComments: boolean;

  // Step 4: Quantization
  enableQuantization: boolean;
  quantizationType: 'scalar' | 'product' | 'binary' | 'optimized-pq';
  quantizationBits: 8 | 16;

  // Step 5: UI Customization
  colorScheme?: 'default' | 'blue' | 'green' | 'orange' | 'dark';
  layout?: 'single' | 'two-column' | 'dashboard';
  fontSize?: 'small' | 'medium' | 'large';
  highContrast?: boolean;
  appTitle?: string;
  logoUrl?: string;
  enableCustomCSS?: boolean;
  customCSS?: string;
}

type ConfigPreset = 'fast' | 'balanced' | 'accurate' | 'memory-efficient';

interface PerformanceEstimate {
  searchSpeed: string;
  memoryUsage: string;
  accuracy: string;
  compressionRatio: string;
}

const defaultConfig: WizardConfig = {
  backend: 'wasm',
  memoryMode: true,
  dimensions: 384,
  enableQuantization: false,
  quantizationType: 'scalar',
  quantizationBits: 8,
  enableHNSW: true,
  M: 16,
  efConstruction: 200,
  efSearch: 50,
  distanceMetric: 'cosine',
  maxM0: 32,
  enableCache: true,
  cacheSize: 1000,
  batchSize: 100,
  enableSwarm: false,
  swarmTopology: 'mesh',
  maxAgents: 5,
  enableHiveMind: false,
  consensusProtocol: 'raft',
  replicationFactor: 3,
  enableCodeGen: false,
  codeStyle: 'typescript',
  includeComments: true,
  exampleType: 'simple',
  includeUI: true,
  includeVisualization: true,
  numCategories: 4,
  similarityThreshold: 0.7,
  enableRealtime: true,
  maxResults: 10,
  deploymentTarget: 'browser',
};

export const WizardModal = ({ open, onOpenChange }: WizardModalProps) => {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState<WizardConfig>(defaultConfig);
  const [showPreview, setShowPreview] = useState(false);
  const { toast } = useToast();
  const contentRef = useRef<HTMLDivElement>(null);

  const totalSteps = 6;

  // Scroll to top when step changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [step]);

  const updateConfig = (updates: Partial<WizardConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };

  const nextStep = () => {
    if (step < totalSteps) setStep(step + 1);
  };

  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  // Configuration Presets
  const applyPreset = (preset: ConfigPreset) => {
    const presets: Record<ConfigPreset, Partial<WizardConfig>> = {
      'fast': {
        enableQuantization: false,
        enableHNSW: true,
        M: 8,
        efConstruction: 100,
        efSearch: 20,
      },
      'balanced': {
        enableQuantization: true,
        quantizationType: 'scalar',
        quantizationBits: 8,
        enableHNSW: true,
        M: 16,
        efConstruction: 200,
        efSearch: 50,
      },
      'accurate': {
        enableQuantization: true,
        quantizationType: 'optimized-pq',
        enableHNSW: true,
        M: 32,
        efConstruction: 400,
        efSearch: 100,
      },
      'memory-efficient': {
        enableQuantization: true,
        quantizationType: 'binary',
        enableHNSW: true,
        M: 8,
        efConstruction: 100,
        efSearch: 30,
      },
    };

    updateConfig(presets[preset]);
    toast({
      title: "Preset applied",
      description: `Configuration set to ${preset.replace('-', ' ')} mode`,
    });
  };

  // Performance Estimates
  const calculatePerformance = (): PerformanceEstimate => {
    let searchSpeed = 1.0; // Base speed in ms
    let memoryPerVector = config.dimensions * 4; // float32 = 4 bytes
    let accuracy = 100;
    let compression = 1;

    // Quantization impact
    if (config.enableQuantization) {
      switch (config.quantizationType) {
        case 'scalar':
          compression = config.quantizationBits === 8 ? 4 : 2;
          memoryPerVector = config.dimensions * (config.quantizationBits / 8);
          accuracy = config.quantizationBits === 8 ? 90 : 97;
          searchSpeed *= 0.5; // 2x faster
          break;
        case 'product':
          compression = 32;
          memoryPerVector = config.dimensions / 4; // ~8 subvectors
          accuracy = 77;
          searchSpeed *= 0.1; // 10x faster
          break;
        case 'binary':
          compression = 256;
          memoryPerVector = config.dimensions / 8; // 1 bit per dimension
          accuracy = 68;
          searchSpeed *= 0.03; // 32x faster
          break;
        case 'optimized-pq':
          compression = 32;
          memoryPerVector = config.dimensions / 4;
          accuracy = 83;
          searchSpeed *= 0.12; // ~8x faster
          break;
      }
    }

    // HNSW impact
    if (config.enableHNSW) {
      searchSpeed *= 0.1; // 10x faster with HNSW
      accuracy = Math.min(accuracy, 97); // HNSW is approximate
      const hnswOverhead = config.M * 8; // edges storage
      memoryPerVector += hnswOverhead;
    } else {
      searchSpeed *= 10; // Brute force is slower
    }

    // Apply efSearch impact
    if (config.enableHNSW) {
      searchSpeed *= (config.efSearch / 50); // Baseline at ef=50
    }

    const totalMemoryFor10k = (memoryPerVector * 10000) / 1024 / 1024; // MB

    return {
      searchSpeed: searchSpeed < 0.1 ? `~${(searchSpeed * 1000).toFixed(0)}μs` : `~${searchSpeed.toFixed(1)}ms`,
      memoryUsage: totalMemoryFor10k < 1
        ? `~${(totalMemoryFor10k * 1024).toFixed(0)}KB for 10K vectors`
        : `~${totalMemoryFor10k.toFixed(1)}MB for 10K vectors`,
      accuracy: `~${accuracy}% recall`,
      compressionRatio: compression > 1 ? `${compression}x compression` : 'No compression',
    };
  };

  // Download HTML file
  const downloadCode = () => {
    const code = generateCode();
    const blob = new Blob([code], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentdb-${config.exampleType}-example.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Downloaded",
      description: `${config.exampleType}-example.html saved to your downloads`,
    });
  };

  // Download SQL database file - creates actual .db file
  const downloadDatabase = async () => {
    try {
      toast({
        title: "Creating Database...",
        description: "Please wait while we generate your database file",
      });

      // Dynamically import AgentDB as ES module
      const { SQLiteVectorDB } = await import('https://unpkg.com/agentdb@1.3.9/dist/agentdb.min.js' as any);

      // Create database
      const db = new SQLiteVectorDB({
        memoryMode: false,
        backend: config.backend,
        ...(config.enableQuantization && {
          enableQuantization: true,
          quantizationType: config.quantizationType,
          ...(config.quantizationType === 'scalar' && { quantizationBits: config.quantizationBits })
        }),
        ...(config.enableHNSW && {
          enableHNSW: true,
          M: config.M,
          efConstruction: config.efConstruction,
        }),
      });

      await db.initializeAsync();

      // Populate with sample data
      for (let i = 0; i < 100; i++) {
        const embedding = new Array(config.dimensions).fill(0).map(() => Math.random());
        const metadata = {
          id: i,
          type: config.exampleType,
          category: `category_${i % config.numCategories}`,
          timestamp: Date.now(),
          description: `Sample ${config.exampleType} item ${i}`
        };
        await db.insert({ embedding, metadata });
      }

      // Export database
      const exportedData = await db.export();

      // Download as .db file
      const blob = new Blob([exportedData], { type: 'application/x-sqlite3' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agentdb-${config.exampleType}-${Date.now()}.db`;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: "Database Downloaded!",
        description: `${(blob.size / 1024).toFixed(2)} KB • 100 vectors • ${config.dimensions} dimensions`,
      });
    } catch (error) {
      console.error('Database export error:', error);
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to create database",
        variant: "destructive",
      });
    }
  };

  // Navigate to a specific step
  const goToStep = (targetStep: number) => {
    if (targetStep >= 1 && targetStep <= totalSteps && targetStep <= step) {
      setStep(targetStep);
    }
  };

  const generateCode = (): string => {
    const { backend, memoryMode, dimensions, enableQuantization, quantizationType, quantizationBits,
            enableHNSW, M, efConstruction, efSearch, exampleType, includeUI, includeVisualization } = config;

    const dbConfigLines: string[] = [];
    dbConfigLines.push(`  memoryMode: ${memoryMode}`);
    dbConfigLines.push(`  backend: '${backend}'`);

    if (enableQuantization) {
      dbConfigLines.push(`  enableQuantization: true`);
      dbConfigLines.push(`  quantizationType: '${quantizationType}'`);
      if (quantizationType === 'scalar') {
        dbConfigLines.push(`  quantizationBits: ${quantizationBits}`);
      } else if (quantizationType === 'product' || quantizationType === 'optimized-pq') {
        dbConfigLines.push(`  subvectors: 8`);
        dbConfigLines.push(`  codebookSize: 256`);
      }
    }

    let exampleCode = '';
    let exampleHTML = '';

    switch (exampleType) {
      case 'simple':
        exampleCode = `
async function runExample() {
  console.log('Initializing AgentDB v1.0.7...');

  // Initialize database
  const db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });

  await db.initializeAsync();
  console.log('✅ Database initialized');

  // Insert sample vectors
  const vectors = [
    { embedding: [0.1, 0.2, 0.3, 0.4, 0.5], metadata: { text: 'Hello world', category: 'greeting' } },
    { embedding: [0.2, 0.3, 0.4, 0.5, 0.6], metadata: { text: 'How are you?', category: 'question' } },
    { embedding: [0.15, 0.25, 0.35, 0.45, 0.55], metadata: { text: 'Good morning', category: 'greeting' } }
  ];

  for (const vec of vectors) {
    await db.insert(vec);
  }
  console.log('✅ Inserted', vectors.length, 'vectors');

  // Search for similar vectors
  const query = [0.12, 0.22, 0.32, 0.42, 0.52];
  const results = await db.search(query, 2);

  console.log('Search results:', results);
  updateResults(results);
}

function updateResults(results) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = '<h3>Search Results:</h3>';

  results.forEach((result, i) => {
    resultsDiv.innerHTML += \`
      <div class="result-card">
        <strong>Result \${i + 1}</strong><br>
        Text: \${result.metadata.text}<br>
        Category: \${result.metadata.category}<br>
        Score: \${result.score.toFixed(4)}
      </div>
    \`;
  });
}

runExample().catch(console.error);`;

        exampleHTML = includeUI ? `
    <div class="container">
      <h1>AgentDB WASM Example</h1>
      <p>Simple vector insertion and search demonstration</p>
      <div id="results"></div>
    </div>` : '';
        break;

      case 'rag':
        exampleCode = `
let db = null;
const documents = [
  { text: "AgentDB is a vector database for AI agents", category: "database" },
  { text: "WASM enables running code in the browser", category: "technology" },
  { text: "Vector search finds similar embeddings", category: "ml" }
];

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  console.log('✅ RAG database initialized (AgentDB latest)');
  return db;
}

// Simple embedding function (in production, use a real model)
function generateEmbedding(text) {
  const words = text.toLowerCase().split(' ');
  const vec = new Array(${dimensions}).fill(0);
  for (let i = 0; i < words.length; i++) {
    const hash = words[i].split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    vec[hash % ${dimensions}] += 0.1;
  }
  return vec;
}

async function indexDocuments() {
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const embedding = generateEmbedding(doc.text);
    await db.insert({ embedding, metadata: doc });
  }
  document.getElementById('status').textContent = \`Indexed \${documents.length} documents\`;
}

async function searchQuery() {
  const query = document.getElementById('query').value;
  if (!query) return;

  const embedding = generateEmbedding(query);
  const results = await db.search(embedding, 3);

  displayResults(results);
}

function displayResults(results) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = '<h3>Retrieved Documents:</h3>';

  results.forEach((result, i) => {
    resultsDiv.innerHTML += \`
      <div class="result-card">
        <strong>\${i + 1}. \${result.metadata.text}</strong><br>
        Category: \${result.metadata.category}<br>
        Similarity: \${(result.score * 100).toFixed(1)}%
      </div>
    \`;
  });
}

window.searchQuery = searchQuery;
initDB().then(indexDocuments);`;

        exampleHTML = `
    <div class="container">
      <h1>RAG Example - Retrieval Augmented Generation</h1>
      <div id="status">Initializing...</div>

      <div class="search-box">
        <input type="text" id="query" placeholder="Ask a question..." />
        <button onclick="searchQuery()">Search</button>
      </div>

      <div id="results"></div>
    </div>`;
        break;

      case 'semantic-search':
        exampleCode = `
let db = null;

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  return db;
}

async function addItem() {
  const text = document.getElementById('itemText').value;
  if (!text) return;

  const embedding = textToVector(text);
  await db.insert({ embedding, metadata: { text, timestamp: Date.now() } });

  document.getElementById('itemText').value = '';
  updateStats();
}

async function searchItems() {
  const query = document.getElementById('searchQuery').value;
  if (!query) return;

  const embedding = textToVector(query);
  const results = await db.search(embedding, 5);

  displayResults(results);
}

function textToVector(text) {
  // Simple hash-based embedding (use real embeddings in production)
  const vec = new Array(${dimensions}).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % ${dimensions}] += text.charCodeAt(i) / 1000;
  }
  return vec;
}

function displayResults(results) {
  const div = document.getElementById('results');
  div.innerHTML = results.map((r, i) => \`
    <div class="result-card">
      <strong>\${i + 1}.</strong> \${r.metadata.text}<br>
      <small>Score: \${(r.score * 100).toFixed(1)}%</small>
    </div>
  \`).join('');
}

async function updateStats() {
  const stats = await db.stats();
  document.getElementById('stats').textContent = \`Total vectors: \${stats.vectorCount}\`;
}

window.addItem = addItem;
window.searchItems = searchItems;
initDB().then(updateStats);`;

        exampleHTML = `
    <div class="container">
      <h1>Semantic Search</h1>

      <div class="add-section">
        <h3>Add Items</h3>
        <input type="text" id="itemText" placeholder="Enter text..." />
        <button onclick="addItem()">Add</button>
        <div id="stats"></div>
      </div>

      <div class="search-section">
        <h3>Search</h3>
        <input type="text" id="searchQuery" placeholder="Search..." />
        <button onclick="searchItems()">Search</button>
      </div>

      <div id="results"></div>
    </div>`;
        break;

      case 'learning':
        exampleCode = `
let db = null;
let learningSession = null;

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  console.log('✅ Learning database initialized (AgentDB latest)');
  return db;
}

async function trainModel() {
  // Store training patterns
  const patterns = [
    { input: [1, 0, 0], output: 'Class A', embedding: [0.9, 0.1, 0.1] },
    { input: [0, 1, 0], output: 'Class B', embedding: [0.1, 0.9, 0.1] },
    { input: [0, 0, 1], output: 'Class C', embedding: [0.1, 0.1, 0.9] }
  ];

  for (const pattern of patterns) {
    await db.insert({
      embedding: pattern.embedding,
      metadata: { input: pattern.input, output: pattern.output }
    });
  }

  document.getElementById('status').textContent = 'Model trained with ' + patterns.length + ' patterns';
}

async function predict() {
  const input = [
    parseFloat(document.getElementById('input1').value) || 0,
    parseFloat(document.getElementById('input2').value) || 0,
    parseFloat(document.getElementById('input3').value) || 0
  ];

  // Normalize to create query vector
  const sum = input.reduce((a, b) => a + b, 0);
  const queryVec = sum > 0 ? input.map(x => x / sum) : [0.33, 0.33, 0.33];

  const results = await db.search(queryVec, 1);

  if (results.length > 0) {
    const prediction = results[0].metadata.output;
    const confidence = (results[0].score * 100).toFixed(1);
    document.getElementById('result').textContent = \`Prediction: \${prediction} (Confidence: \${confidence}%)\`;
  }
}

window.trainModel = trainModel;
window.predict = predict;
initDB().then(trainModel);`;

        exampleHTML = `
    <div class="container">
      <h1>Learning Example</h1>
      <div id="status">Initializing...</div>

      <div class="train-section">
        <button onclick="trainModel()">Train Model</button>
      </div>

      <div class="predict-section">
        <h3>Make Prediction</h3>
        <input type="number" id="input1" placeholder="Input 1" step="0.1" />
        <input type="number" id="input2" placeholder="Input 2" step="0.1" />
        <input type="number" id="input3" placeholder="Input 3" step="0.1" />
        <button onclick="predict()">Predict</button>
        <div id="result"></div>
      </div>
    </div>`;
        break;

      case 'clustering':
        exampleCode = `
let db = null;
let points = [];

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  return db;
}

function generateRandomPoints(count) {
  points = [];
  for (let i = 0; i < count; i++) {
    const cluster = Math.floor(Math.random() * 3);
    const centerX = cluster * 0.3 + 0.15;
    const centerY = Math.random() * 0.8 + 0.1;

    points.push({
      x: centerX + (Math.random() - 0.5) * 0.2,
      y: centerY + (Math.random() - 0.5) * 0.2,
      cluster: -1
    });
  }
  return points;
}

async function runClustering() {
  const count = parseInt(document.getElementById('pointCount').value) || 50;
  generateRandomPoints(count);

  // Insert points into database
  for (let i = 0; i < points.length; i++) {
    const embedding = [points[i].x, points[i].y];
    await db.insert({ embedding, metadata: { id: i, x: points[i].x, y: points[i].y } });
  }

  // Find clusters using k-nearest neighbors
  for (let i = 0; i < points.length; i++) {
    const queryVec = [points[i].x, points[i].y];
    const neighbors = await db.search(queryVec, 5);

    // Assign cluster based on neighbors
    points[i].cluster = i % 3;
  }

  ${includeVisualization ? 'visualizeClusters();' : 'displayClusterStats();'}
  document.getElementById('status').textContent = \`Clustered \${count} points\`;
}

${includeVisualization ? `
function visualizeClusters() {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const colors = ['#00d4ff', '#ff006e', '#00ff88'];

  points.forEach(point => {
    ctx.fillStyle = colors[point.cluster % 3];
    ctx.beginPath();
    ctx.arc(point.x * canvas.width, point.y * canvas.height, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}` : `
function displayClusterStats() {
  const clusters = {};
  points.forEach(p => {
    clusters[p.cluster] = (clusters[p.cluster] || 0) + 1;
  });

  const statsDiv = document.getElementById('stats');
  statsDiv.innerHTML = '<h3>Cluster Distribution:</h3>' +
    Object.entries(clusters).map(([id, count]) =>
      \`<div>Cluster \${id}: \${count} points</div>\`
    ).join('');
}`}

window.runClustering = runClustering;
initDB().then(() => runClustering());`;

        exampleHTML = includeVisualization ? `
    <div class="container">
      <h1>Clustering Example</h1>
      <div id="status">Initializing...</div>

      <div class="controls">
        <input type="number" id="pointCount" value="50" min="10" max="200" />
        <button onclick="runClustering()">Run Clustering</button>
      </div>

      <canvas id="canvas" width="600" height="400"></canvas>
    </div>` : `
    <div class="container">
      <h1>Clustering Example</h1>
      <div id="status">Initializing...</div>

      <div class="controls">
        <input type="number" id="pointCount" value="50" min="10" max="200" />
        <button onclick="runClustering()">Run Clustering</button>
      </div>

      <div id="stats"></div>
    </div>`;
        break;

      case 'anomaly-detection':
        exampleCode = `
let db = null;
const normalData = [];
const anomalyThreshold = 0.7; // Similarity threshold

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  console.log('✅ Anomaly detection database initialized');
  return db;
}

function generateNormalData(count = 50) {
  // Generate normal distribution around center
  for (let i = 0; i < count; i++) {
    const vec = new Array(${dimensions}).fill(0).map(() =>
      0.5 + (Math.random() - 0.5) * 0.2 // Normal: 0.4 - 0.6 range
    );
    normalData.push(vec);
    db.insert({ embedding: vec, metadata: { type: 'normal', id: i } });
  }
  document.getElementById('status').textContent = \`Trained on \${count} normal examples\`;
}

async function detectAnomaly() {
  const testVec = new Array(${dimensions}).fill(0).map(() =>
    parseFloat(document.getElementById('testInput').value) || Math.random()
  );

  // Find nearest normal examples
  const results = await db.search(testVec, 5);

  // Calculate average similarity to normal data
  const avgSimilarity = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  const isAnomaly = avgSimilarity < anomalyThreshold;
  const confidence = Math.abs(avgSimilarity - anomalyThreshold) * 100;

  displayResult(isAnomaly, avgSimilarity, confidence);
}

function displayResult(isAnomaly, similarity, confidence) {
  const resultDiv = document.getElementById('result');
  resultDiv.className = isAnomaly ? 'result-card anomaly' : 'result-card normal';
  resultDiv.innerHTML = \`
    <h3>\${isAnomaly ? '⚠️ Anomaly Detected' : '✓ Normal Behavior'}</h3>
    <p>Similarity to normal: \${(similarity * 100).toFixed(1)}%</p>
    <p>Confidence: \${confidence.toFixed(1)}%</p>
  \`;
}

window.detectAnomaly = detectAnomaly;
initDB().then(() => generateNormalData(50));`;

        exampleHTML = `
    <div class="container">
      <h1>Anomaly Detection</h1>
      <div id="status">Initializing...</div>

      <div class="test-section">
        <h3>Test for Anomalies</h3>
        <input type="number" id="testInput" placeholder="Test value (0-1)" step="0.01" value="0.5" />
        <button onclick="detectAnomaly()">Detect</button>
      </div>

      <div id="result"></div>
    </div>`;
        break;

      case 'text-classification':
        exampleCode = `
let db = null;
const categories = ['technology', 'sports', 'politics', 'entertainment'];
const trainingData = {
  technology: ['AI machine learning', 'programming code', 'computer software', 'data science'],
  sports: ['football soccer', 'basketball game', 'tennis match', 'olympics competition'],
  politics: ['election vote', 'government policy', 'senate debate', 'president speech'],
  entertainment: ['movie film', 'music concert', 'celebrity actor', 'tv show series']
};

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  console.log('✅ Text classification database initialized');
  return db;
}

function textToEmbedding(text) {
  // Simple bag-of-words embedding (use real embeddings in production)
  const words = text.toLowerCase().split(' ');
  const vec = new Array(${dimensions}).fill(0);

  words.forEach(word => {
    const hash = word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    vec[hash % ${dimensions}] += 1;
  });

  // Normalize
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => magnitude > 0 ? v / magnitude : 0);
}

async function trainClassifier() {
  let count = 0;

  for (const [category, examples] of Object.entries(trainingData)) {
    for (const text of examples) {
      const embedding = textToEmbedding(text);
      await db.insert({ embedding, metadata: { category, text } });
      count++;
    }
  }

  document.getElementById('status').textContent = \`Trained on \${count} examples across \${categories.length} categories\`;
}

async function classifyText() {
  const text = document.getElementById('textInput').value;
  if (!text) return;

  const embedding = textToEmbedding(text);
  const results = await db.search(embedding, 3);

  displayClassification(text, results);
}

function displayClassification(text, results) {
  const resultDiv = document.getElementById('results');
  resultDiv.innerHTML = \`
    <h3>Classification Results for: "\${text}"</h3>
    <div class="predictions">
      \${results.map((r, i) => \`
        <div class="result-card">
          <strong>\${i + 1}. \${r.metadata.category}</strong><br>
          Similar to: "\${r.metadata.text}"<br>
          Confidence: \${(r.score * 100).toFixed(1)}%
        </div>
      \`).join('')}
    </div>
  \`;
}

window.classifyText = classifyText;
initDB().then(trainClassifier);`;

        exampleHTML = `
    <div class="container">
      <h1>Text Classification</h1>
      <div id="status">Initializing...</div>

      <div class="classify-section">
        <h3>Classify Text</h3>
        <input type="text" id="textInput" placeholder="Enter text to classify..." />
        <button onclick="classifyText()">Classify</button>
      </div>

      <div id="results"></div>
    </div>`;
        break;

      case 'recommendation-system':
        exampleCode = `
let db = null;
const items = [
  { id: 1, name: 'Sci-Fi Movie A', tags: ['scifi', 'action', 'space'] },
  { id: 2, name: 'Drama Movie B', tags: ['drama', 'romance', 'emotional'] },
  { id: 3, name: 'Comedy Movie C', tags: ['comedy', 'funny', 'lighthearted'] },
  { id: 4, name: 'Sci-Fi Movie D', tags: ['scifi', 'thriller', 'future'] },
  { id: 5, name: 'Action Movie E', tags: ['action', 'adventure', 'explosive'] },
  { id: 6, name: 'Drama Movie F', tags: ['drama', 'mystery', 'dark'] },
];

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  console.log('✅ Recommendation system initialized');
  return db;
}

function tagsToEmbedding(tags) {
  // Convert tags to vector (simple one-hot encoding)
  const allTags = ['scifi', 'action', 'space', 'drama', 'romance', 'emotional',
                   'comedy', 'funny', 'lighthearted', 'thriller', 'future',
                   'adventure', 'explosive', 'mystery', 'dark'];

  const vec = new Array(${dimensions}).fill(0);
  tags.forEach(tag => {
    const idx = allTags.indexOf(tag.toLowerCase());
    if (idx !== -1 && idx < ${dimensions}) {
      vec[idx] = 1;
    }
  });

  return vec;
}

async function indexItems() {
  for (const item of items) {
    const embedding = tagsToEmbedding(item.tags);
    await db.insert({ embedding, metadata: item });
  }

  displayItems();
  document.getElementById('status').textContent = \`Indexed \${items.length} items\`;
}

function displayItems() {
  const itemsDiv = document.getElementById('items');
  itemsDiv.innerHTML = '<h3>Available Items:</h3>' +
    items.map(item => \`
      <div class="item-card" onclick="getRecommendations(\${item.id})">
        <strong>\${item.name}</strong><br>
        <small>\${item.tags.join(', ')}</small>
      </div>
    \`).join('');
}

async function getRecommendations(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;

  const embedding = tagsToEmbedding(item.tags);
  const results = await db.search(embedding, 4); // Get top 4 (including self)

  // Filter out the selected item
  const recommendations = results.filter(r => r.metadata.id !== itemId).slice(0, 3);

  displayRecommendations(item, recommendations);
}

function displayRecommendations(selectedItem, recommendations) {
  const recDiv = document.getElementById('recommendations');
  recDiv.innerHTML = \`
    <h3>Because you liked "\${selectedItem.name}":</h3>
    \${recommendations.map((r, i) => \`
      <div class="result-card">
        <strong>\${i + 1}. \${r.metadata.name}</strong><br>
        Tags: \${r.metadata.tags.join(', ')}<br>
        Match: \${(r.score * 100).toFixed(0)}%
      </div>
    \`).join('')}
  \`;
}

window.getRecommendations = getRecommendations;
initDB().then(indexItems);`;

        exampleHTML = `
    <div class="container">
      <h1>Recommendation System</h1>
      <div id="status">Initializing...</div>

      <div id="items"></div>
      <div id="recommendations"></div>
    </div>`;
        break;

      case 'ecommerce-search':
        exampleCode = `
let db = null;
const products = [
  { id: 1, name: 'Wireless Headphones', description: 'Premium noise-canceling wireless headphones with long battery life', category: 'Electronics', price: 299 },
  { id: 2, name: 'Running Shoes', description: 'Lightweight athletic shoes for running and training', category: 'Sports', price: 89 },
  { id: 3, name: 'Bluetooth Speaker', description: 'Portable waterproof speaker with powerful bass', category: 'Electronics', price: 79 },
  { id: 4, name: 'Yoga Mat', description: 'Non-slip exercise mat for yoga and fitness', category: 'Sports', price: 35 },
  { id: 5, name: 'Smart Watch', description: 'Fitness tracker with heart rate monitoring', category: 'Electronics', price: 199 },
  { id: 6, name: 'Protein Powder', description: 'Whey protein supplement for muscle recovery', category: 'Health', price: 45 },
  { id: 7, name: 'Coffee Maker', description: 'Programmable coffee maker with thermal carafe', category: 'Home', price: 129 },
  { id: 8, name: 'Basketball', description: 'Official size basketball for indoor/outdoor use', category: 'Sports', price: 29 },
];

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  console.log('✅ E-commerce search initialized');
  return db;
}

function productToEmbedding(product) {
  const text = \`\${product.name} \${product.description} \${product.category}\`.toLowerCase();
  const words = text.split(/\\s+/);
  const vec = new Array(${config.dimensions}).fill(0);

  words.forEach((word, idx) => {
    const hash = word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    vec[hash % ${config.dimensions}] += 1;
  });

  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => magnitude > 0 ? v / magnitude : 0);
}

async function indexProducts() {
  for (const product of products) {
    const embedding = productToEmbedding(product);
    await db.insert({ embedding, metadata: product });
  }

  document.getElementById('status').innerHTML = \`<span class="success">Indexed \${products.length} products</span>\`;
  console.log(\`Indexed \${products.length} products\`);
}

async function searchProducts() {
  const query = document.getElementById('searchInput').value;
  if (!query) return;

  const queryEmbed = productToEmbedding({ name: query, description: query, category: '' });
  const results = await db.search(queryEmbed, ${config.maxResults});

  displayResults(query, results);
}

function displayResults(query, results) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = \`
    <h3>Search Results for "\${query}"</h3>
    \${results.map((r, i) => \`
      <div class="product-card">
        <div class="product-header">
          <strong>\${i + 1}. \${r.metadata.name}</strong>
          <span class="price">\$\${r.metadata.price}</span>
        </div>
        <p class="product-description">\${r.metadata.description}</p>
        <div class="product-footer">
          <span class="category">\${r.metadata.category}</span>
          <span class="match">Match: \${(r.score * 100).toFixed(0)}%</span>
        </div>
      </div>
    \`).join('')}
  \`;
}

window.searchProducts = searchProducts;
initDB().then(indexProducts);`;

        exampleHTML = `
    <div class="container">
      <h1>🛍️ E-commerce Product Search</h1>
      <div id="status">Initializing...</div>

      <div class="search-box">
        <input type="text" id="searchInput" placeholder="Search for products... (e.g., 'wireless audio', 'fitness equipment')" />
        <button onclick="searchProducts()">Search</button>
      </div>

      <div id="results"></div>
    </div>`;
        break;

      case 'customer-support':
        exampleCode = `
let db = null;
const faqs = [
  { id: 1, question: 'How do I reset my password?', answer: 'Go to Settings > Account > Reset Password and follow the instructions', category: 'account' },
  { id: 2, question: 'What are your shipping times?', answer: 'Standard shipping takes 3-5 business days. Express shipping is 1-2 days', category: 'shipping' },
  { id: 3, question: 'How can I track my order?', answer: 'Use the tracking number sent to your email at My Orders page', category: 'orders' },
  { id: 4, question: 'What is your return policy?', answer: '30-day money-back guarantee. Items must be unused and in original packaging', category: 'returns' },
  { id: 5, question: 'Do you offer international shipping?', answer: 'Yes, we ship to over 50 countries worldwide', category: 'shipping' },
  { id: 6, question: 'How do I contact customer support?', answer: 'Email support@example.com or call 1-800-SUPPORT (9am-6pm EST)', category: 'support' },
  { id: 7, question: 'Can I change my order after placing it?', answer: 'Yes, within 1 hour of placing the order via your account page', category: 'orders' },
  { id: 8, question: 'Do you have a mobile app?', answer: 'Yes, available on iOS App Store and Google Play Store', category: 'technical' },
];

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  console.log('✅ Customer support initialized');
  return db;
}

function textToEmbedding(text) {
  const words = text.toLowerCase().split(/\\s+/);
  const vec = new Array(${config.dimensions}).fill(0);

  words.forEach((word, idx) => {
    const hash = word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    vec[hash % ${config.dimensions}] += 1;
  });

  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => magnitude > 0 ? v / magnitude : 0);
}

async function indexFAQs() {
  for (const faq of faqs) {
    const embedding = textToEmbedding(faq.question + ' ' + faq.answer);
    await db.insert({ embedding, metadata: faq });
  }

  document.getElementById('status').innerHTML = \`<span class="success">Indexed \${faqs.length} FAQs</span>\`;
}

async function searchFAQs() {
  const query = document.getElementById('queryInput').value;
  if (!query) return;

  const queryEmbed = textToEmbedding(query);
  const results = await db.search(queryEmbed, ${config.maxResults});

  displayFAQResults(query, results);
}

function displayFAQResults(query, results) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = \`
    <h3>Suggested Answers for: "\${query}"</h3>
    \${results.map((r, i) => \`
      <div class="faq-card \${r.score > ${config.similarityThreshold} ? 'high-confidence' : ''}">
        <div class="faq-header">
          <strong>Q: \${r.metadata.question}</strong>
          <span class="category-badge">\${r.metadata.category}</span>
        </div>
        <p class="faq-answer"><strong>A:</strong> \${r.metadata.answer}</p>
        <div class="confidence">Confidence: \${(r.score * 100).toFixed(0)}%</div>
      </div>
    \`).join('')}
  \`;
}

window.searchFAQs = searchFAQs;
initDB().then(indexFAQs);`;

        exampleHTML = `
    <div class="container">
      <h1>🎧 Customer Support Assistant</h1>
      <div id="status">Initializing...</div>

      <div class="search-box">
        <input type="text" id="queryInput" placeholder="Ask a question... (e.g., 'How do I return an item?')" />
        <button onclick="searchFAQs()">Find Answer</button>
      </div>

      <div id="results"></div>
    </div>`;
        break;

      case 'fraud-detection':
        exampleCode = `
let db = null;
let transactions = [];
const normalPatterns = [];

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  console.log('✅ Fraud detection initialized');
  return db;
}

function transactionToEmbedding(txn) {
  const vec = new Array(${config.dimensions}).fill(0);
  vec[0] = txn.amount / 1000; // Normalize amount
  vec[1] = txn.hour / 24; // Hour of day
  vec[2] = txn.dayOfWeek / 7; // Day of week
  vec[3] = txn.merchantCategory / 10; // Merchant category
  vec[4] = txn.isInternational ? 1 : 0;
  vec[5] = txn.isOnline ? 1 : 0;

  for (let i = 6; i < ${config.dimensions}; i++) {
    vec[i] = Math.random() * 0.1; // Add noise for uniqueness
  }

  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => magnitude > 0 ? v / magnitude : 0);
}

async function trainNormalPatterns() {
  // Generate 50 normal transaction patterns
  for (let i = 0; i < 50; i++) {
    const normalTxn = {
      amount: Math.random() * 200 + 10, // $10-$210
      hour: Math.floor(Math.random() * 12) + 8, // 8am-8pm
      dayOfWeek: Math.floor(Math.random() * 5), // Mon-Fri
      merchantCategory: Math.floor(Math.random() * 5), // Common categories
      isInternational: false,
      isOnline: Math.random() > 0.5,
    };

    const embedding = transactionToEmbedding(normalTxn);
    await db.insert({ embedding, metadata: { type: 'normal', ...normalTxn } });
    normalPatterns.push(normalTxn);
  }

  document.getElementById('status').innerHTML = \`<span class="success">Trained on \${normalPatterns.length} normal transactions</span>\`;
}

async function checkTransaction() {
  const txn = {
    amount: parseFloat(document.getElementById('amount').value) || 100,
    hour: parseInt(document.getElementById('hour').value) || 12,
    dayOfWeek: parseInt(document.getElementById('dayOfWeek').value) || 3,
    merchantCategory: parseInt(document.getElementById('category').value) || 2,
    isInternational: document.getElementById('international').checked,
    isOnline: document.getElementById('online').checked,
  };

  const embedding = transactionToEmbedding(txn);
  const results = await db.search(embedding, 5);
  const avgSimilarity = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  const isFraud = avgSimilarity < ${config.similarityThreshold};
  const risk = isFraud ? 'HIGH' : avgSimilarity < 0.85 ? 'MEDIUM' : 'LOW';

  displayFraudResult(txn, avgSimilarity, risk, isFraud);
}

function displayFraudResult(txn, similarity, risk, isFraud) {
  const resultDiv = document.getElementById('result');
  resultDiv.innerHTML = \`
    <div class="fraud-result \${isFraud ? 'fraud' : 'normal'}">
      <h3>\${isFraud ? '⚠️ FRAUD ALERT' : '✓ Transaction Approved'}</h3>
      <div class="fraud-details">
        <p><strong>Amount:</strong> \$\${txn.amount}</p>
        <p><strong>Risk Level:</strong> \${risk}</p>
        <p><strong>Similarity to Normal:</strong> \${(similarity * 100).toFixed(1)}%</p>
        <p><strong>Time:</strong> \${txn.hour}:00, Day \${txn.dayOfWeek}</p>
        <p><strong>Flags:</strong> \${txn.isInternational ? 'International, ' : ''}\${txn.isOnline ? 'Online' : 'In-person'}</p>
      </div>
      <p class="recommendation">\${isFraud ? 'Recommend: Block transaction and contact customer' : 'Recommendation: Approve transaction'}</p>
    </div>
  \`;
}

window.checkTransaction = checkTransaction;
initDB().then(trainNormalPatterns);`;

        exampleHTML = `
    <div class="container">
      <h1>🔒 Fraud Detection System</h1>
      <div id="status">Initializing...</div>

      <div class="txn-form">
        <h3>Test Transaction</h3>
        <div class="form-row">
          <label>Amount ($): <input type="number" id="amount" value="100" step="0.01" /></label>
          <label>Hour (0-23): <input type="number" id="hour" value="14" min="0" max="23" /></label>
        </div>
        <div class="form-row">
          <label>Day of Week (0-6): <input type="number" id="dayOfWeek" value="3" min="0" max="6" /></label>
          <label>Category (0-9): <input type="number" id="category" value="2" min="0" max="9" /></label>
        </div>
        <div class="form-row">
          <label><input type="checkbox" id="international" /> International</label>
          <label><input type="checkbox" id="online" checked /> Online Payment</label>
        </div>
        <button onclick="checkTransaction()">Check Transaction</button>
      </div>

      <div id="result"></div>
    </div>`;
        break;

      case 'code-search':
        exampleCode = `
let db = null;
const codeSnippets = [
  { id: 1, func: 'fetchUser', code: 'async function fetchUser(id) { return await api.get(\`/users/\${id}\`); }', lang: 'javascript', tags: ['api', 'async', 'user'] },
  { id: 2, func: 'validateEmail', code: 'function validateEmail(email) { return /^[^@]+@[^@]+\\.[^@]+$/.test(email); }', lang: 'javascript', tags: ['validation', 'email', 'regex'] },
  { id: 3, func: 'formatDate', code: 'function formatDate(date) { return new Date(date).toLocaleDateString(); }', lang: 'javascript', tags: ['date', 'format', 'utility'] },
  { id: 4, func: 'debounce', code: 'function debounce(func, wait) { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func(...args), wait); }; }', lang: 'javascript', tags: ['performance', 'utility', 'async'] },
  { id: 5, func: 'deepClone', code: 'function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }', lang: 'javascript', tags: ['object', 'clone', 'utility'] },
  { id: 6, func: 'sortArray', code: 'function sortArray(arr, key) { return arr.sort((a, b) => a[key] - b[key]); }', lang: 'javascript', tags: ['array', 'sort', 'algorithm'] },
];

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  console.log('✅ Code search initialized');
  return db;
}

function codeToEmbedding(snippet) {
  const text = \`\${snippet.func} \${snippet.code} \${snippet.tags.join(' ')}\`.toLowerCase();
  const words = text.split(/\\s+/);
  const vec = new Array(${config.dimensions}).fill(0);

  words.forEach((word, idx) => {
    const hash = word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    vec[hash % ${config.dimensions}] += 1;
  });

  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => magnitude > 0 ? v / magnitude : 0);
}

async function indexCode() {
  for (const snippet of codeSnippets) {
    const embedding = codeToEmbedding(snippet);
    await db.insert({ embedding, metadata: snippet });
  }

  document.getElementById('status').innerHTML = \`<span class="success">Indexed \${codeSnippets.length} code snippets</span>\`;
}

async function searchCode() {
  const query = document.getElementById('codeQuery').value;
  if (!query) return;

  const queryEmbed = codeToEmbedding({ func: query, code: query, tags: query.split(' ') });
  const results = await db.search(queryEmbed, ${config.maxResults});

  displayCodeResults(query, results);
}

function displayCodeResults(query, results) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = \`
    <h3>Code Search Results for "\${query}"</h3>
    \${results.map((r, i) => \`
      <div class="code-card">
        <div class="code-header">
          <strong>\${r.metadata.func}</strong>
          <span class="lang-badge">\${r.metadata.lang}</span>
          <span class="match">Match: \${(r.score * 100).toFixed(0)}%</span>
        </div>
        <pre><code>\${r.metadata.code}</code></pre>
        <div class="code-tags">\${r.metadata.tags.map(tag => \`<span class="tag">\${tag}</span>\`).join('')}</div>
      </div>
    \`).join('')}
  \`;
}

window.searchCode = searchCode;
initDB().then(indexCode);`;

        exampleHTML = `
    <div class="container">
      <h1>🔍 Code Search Engine</h1>
      <div id="status">Initializing...</div>

      <div class="search-box">
        <input type="text" id="codeQuery" placeholder="Search for code... (e.g., 'validate email', 'async data fetch')" />
        <button onclick="searchCode()">Search Code</button>
      </div>

      <div id="results"></div>
    </div>`;
        break;

      case 'sentiment-analysis':
        exampleCode = `
let db = null;
const sentiments = ['very_negative', 'negative', 'neutral', 'positive', 'very_positive'];
const trainingData = {
  very_negative: ['terrible awful horrible hate worst disaster', 'disappointed frustrated angry upset unhappy'],
  negative: ['bad poor mediocre unsatisfied dislike', 'below average not good could be better'],
  neutral: ['okay fine average acceptable neutral', 'nothing special decent standard'],
  positive: ['good nice happy satisfied like', 'pleasant enjoyable well done appreciate'],
  very_positive: ['excellent amazing fantastic love best outstanding', 'perfect wonderful incredible awesome exceptional']
};

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  console.log('✅ Sentiment analysis initialized');
  return db;
}

function textToEmbedding(text) {
  const words = text.toLowerCase().split(/\\s+/);
  const vec = new Array(${config.dimensions}).fill(0);

  words.forEach(word => {
    const hash = word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    vec[hash % ${config.dimensions}] += 1;
  });

  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => magnitude > 0 ? v / magnitude : 0);
}

async function trainModel() {
  let count = 0;
  for (const [sentiment, examples] of Object.entries(trainingData)) {
    for (const example of examples) {
      const embedding = textToEmbedding(example);
      await db.insert({ embedding, metadata: { sentiment, example } });
      count++;
    }
  }

  document.getElementById('status').innerHTML = \`<span class="success">Trained on \${count} examples across ${config.numCategories} sentiment levels</span>\`;
}

async function analyzeSentiment() {
  const text = document.getElementById('textInput').value;
  if (!text) return;

  const embedding = textToEmbedding(text);
  const results = await db.search(embedding, 3);

  const sentimentCounts = {};
  results.forEach(r => {
    sentimentCounts[r.metadata.sentiment] = (sentimentCounts[r.metadata.sentiment] || 0) + r.score;
  });

  const topSentiment = Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])[0];
  const confidence = topSentiment[1] / results.reduce((sum, r) => sum + r.score, 0);

  displaySentimentResult(text, topSentiment[0], confidence, results);
}

function displaySentimentResult(text, sentiment, confidence, examples) {
  const resultDiv = document.getElementById('result');
  const sentimentEmoji = { very_negative: '😡', negative: '😞', neutral: '😐', positive: '😊', very_positive: '🤩' };

  resultDiv.innerHTML = \`
    <div class="sentiment-result \${sentiment}">
      <div class="sentiment-header">
        <h3>\${sentimentEmoji[sentiment]} \${sentiment.replace('_', ' ').toUpperCase()}</h3>
        <span class="confidence">Confidence: \${(confidence * 100).toFixed(0)}%</span>
      </div>
      <p class="analyzed-text">"\${text}"</p>
      <h4>Similar Examples:</h4>
      \${examples.map((r, i) => \`
        <div class="example">
          <strong>\${r.metadata.sentiment}:</strong> "\${r.metadata.example}"
          <span class="match">(\${(r.score * 100).toFixed(0)}%)</span>
        </div>
      \`).join('')}
    </div>
  \`;
}

window.analyzeSentiment = analyzeSentiment;
initDB().then(trainModel);`;

        exampleHTML = `
    <div class="container">
      <h1>💭 Sentiment Analysis</h1>
      <div id="status">Initializing...</div>

      <div class="input-area">
        <textarea id="textInput" placeholder="Enter text to analyze... (e.g., 'This product is amazing!', 'Very disappointed with the service')" rows="4"></textarea>
        <button onclick="analyzeSentiment()">Analyze Sentiment</button>
      </div>

      <div id="result"></div>
    </div>`;
        break;

      case 'duplicate-detection':
        exampleCode = `
let db = null;
const documents = [];

async function initDB() {
  db = new SQLiteVectorDB({
${dbConfigLines.map(line => '    ' + line).join(',\n')}
  });
  await db.initializeAsync();
  console.log('✅ Duplicate detection initialized');
  return db;
}

function textToEmbedding(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\\s]/g, '').split(/\\s+/);
  const vec = new Array(${config.dimensions}).fill(0);

  words.forEach((word, idx) => {
    const hash = word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    vec[hash % ${config.dimensions}] += 1;
  });

  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map(v => magnitude > 0 ? v / magnitude : 0);
}

async function addDocument() {
  const text = document.getElementById('docInput').value.trim();
  if (!text) return;

  const embedding = textToEmbedding(text);
  const results = await db.search(embedding, 1);

  const isDuplicate = results.length > 0 && results[0].score > ${config.similarityThreshold};

  if (isDuplicate) {
    displayDuplicateWarning(text, results[0]);
  } else {
    const docId = documents.length + 1;
    const doc = { id: docId, text, timestamp: Date.now() };
    documents.push(doc);
    await db.insert({ embedding, metadata: doc });

    document.getElementById('docInput').value = '';
    updateDocumentList();
    document.getElementById('result').innerHTML = \`<div class="success">✓ Document added (ID: \${docId})</div>\`;
  }
}

function displayDuplicateWarning(newText, duplicate) {
  const resultDiv = document.getElementById('result');
  resultDiv.innerHTML = \`
    <div class="duplicate-warning">
      <h3>⚠️ Possible Duplicate Detected</h3>
      <div class="duplicate-details">
        <div>
          <strong>New Document:</strong>
          <p class="doc-text">"\${newText}"</p>
        </div>
        <div>
          <strong>Existing Document (ID: \${duplicate.metadata.id}):</strong>
          <p class="doc-text">"\${duplicate.metadata.text}"</p>
        </div>
        <div class="similarity">
          <strong>Similarity:</strong> \${(duplicate.score * 100).toFixed(1)}%
        </div>
      </div>
      <p class="recommendation">Consider reviewing before adding to prevent duplicate content.</p>
    </div>
  \`;
}

function updateDocumentList() {
  const listDiv = document.getElementById('docList');
  listDiv.innerHTML = \`
    <h3>Indexed Documents (\${documents.length})</h3>
    \${documents.map(doc => \`
      <div class="doc-item">
        <strong>ID \${doc.id}:</strong> \${doc.text.substring(0, 100)}\${doc.text.length > 100 ? '...' : ''}
      </div>
    \`).join('')}
  \`;
}

window.addDocument = addDocument;
initDB();`;

        exampleHTML = `
    <div class="container">
      <h1>📑 Duplicate Content Detection</h1>
      <div id="status">Threshold: ${config.similarityThreshold * 100}% similarity</div>

      <div class="input-area">
        <textarea id="docInput" placeholder="Paste document or content to check for duplicates..." rows="4"></textarea>
        <button onclick="addDocument()">Check & Add Document</button>
      </div>

      <div id="result"></div>
      <div id="docList"></div>
    </div>`;
        break;
    }

    // Apply UI customization settings
    const getColorScheme = () => {
      switch (config.colorScheme || 'default') {
        case 'blue': return { primary: 'hsl(210 100% 60%)', primaryHover: 'hsl(210 100% 70%)' };
        case 'green': return { primary: 'hsl(140 70% 50%)', primaryHover: 'hsl(140 70% 60%)' };
        case 'orange': return { primary: 'hsl(30 100% 55%)', primaryHover: 'hsl(30 100% 65%)' };
        case 'dark': return { primary: 'hsl(0 0% 60%)', primaryHover: 'hsl(0 0% 70%)' };
        default: return { primary: 'hsl(195 100% 60%)', primaryHover: 'hsl(195 100% 70%)' };
      }
    };

    const getFontSize = () => {
      switch (config.fontSize || 'medium') {
        case 'small': return '14px';
        case 'large': return '18px';
        default: return '16px';
      }
    };

    const colors = getColorScheme();
    const baseFontSize = getFontSize();
    const highContrast = config.highContrast || false;

    const styles = `
    body {
      margin: 0;
      padding: 20px;
      font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
      background: ${highContrast ? 'hsl(0 0% 0%)' : 'hsl(0 0% 12%)'};
      color: ${highContrast ? 'hsl(0 0% 100%)' : 'hsl(0 0% 95%)'};
      font-size: ${baseFontSize};
    }

    ${config.logoUrl ? `.logo { max-width: 200px; margin-bottom: 1rem; }` : ''}

    .container {
      max-width: ${config.layout === 'dashboard' ? '1200px' : '800px'};
      margin: 0 auto;
      ${config.layout === 'two-column' ? 'display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;' : ''}
      ${config.layout === 'dashboard' ? 'display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;' : ''}
    }

    h1 {
      color: ${colors.primary};
      font-size: ${config.fontSize === 'small' ? '1.75rem' : config.fontSize === 'large' ? '2.5rem' : '2rem'};
      margin-bottom: 1rem;
    }

    h3 {
      color: ${colors.primary};
      margin-top: 1.5rem;
    }

    .result-card {
      background: ${highContrast ? 'hsl(0 0% 10%)' : 'hsl(0 0% 15%)'};
      border: 1px solid ${highContrast ? 'hsl(0 0% 40%)' : 'hsl(0 0% 25%)'};
      border-radius: 8px;
      padding: 1rem;
      margin: 0.5rem 0;
      ${config.layout === 'dashboard' ? 'box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);' : ''}
    }

    input, button {
      background: ${highContrast ? 'hsl(0 0% 10%)' : 'hsl(0 0% 15%)'};
      border: 1px solid ${highContrast ? 'hsl(0 0% 40%)' : 'hsl(0 0% 25%)'};
      border-radius: 8px;
      padding: 0.5rem 1rem;
      color: ${highContrast ? 'hsl(0 0% 100%)' : 'hsl(0 0% 95%)'};
      font-family: inherit;
      margin: 0.25rem;
    }

    button {
      background: ${colors.primary};
      color: hsl(0 0% 12%);
      cursor: pointer;
      font-weight: 600;
    }

    button:hover {
      background: ${colors.primaryHover};
    }

    input {
      min-width: 200px;
    }

    #status {
      color: ${colors.primary};
      margin: 1rem 0;
    }

    #results {
      margin-top: 2rem;
      ${config.layout === 'two-column' ? 'grid-column: 2;' : ''}
    }

    .search-box, .add-section, .search-section, .train-section, .predict-section, .controls {
      margin: 1.5rem 0;
      padding: 1rem;
      background: ${highContrast ? 'hsl(0 0% 10%)' : 'hsl(0 0% 15%)'};
      border-radius: 8px;
      border: 1px solid ${highContrast ? 'hsl(0 0% 40%)' : 'hsl(0 0% 25%)'};
      ${config.layout === 'two-column' ? 'grid-column: 1;' : ''}
    }

    canvas {
      border: 1px solid ${highContrast ? 'hsl(0 0% 40%)' : 'hsl(0 0% 25%)'};
      border-radius: 8px;
      background: ${highContrast ? 'hsl(0 0% 0%)' : 'hsl(0 0% 8%)'};
      margin-top: 1rem;
    }

    .test-section, .classify-section {
      margin: 1.5rem 0;
      padding: 1rem;
      background: ${highContrast ? 'hsl(0 0% 10%)' : 'hsl(0 0% 15%)'};
      border-radius: 8px;
      border: 1px solid ${highContrast ? 'hsl(0 0% 40%)' : 'hsl(0 0% 25%)'};
    }

    .anomaly {
      border-color: hsl(0 100% 60%);
      background: hsl(0 100% 60% / 0.1);
    }

    .normal {
      border-color: hsl(120 100% 60%);
      background: hsl(120 100% 60% / 0.1);
    }

    .item-card {
      background: ${highContrast ? 'hsl(0 0% 10%)' : 'hsl(0 0% 15%)'};
      border: 1px solid ${highContrast ? 'hsl(0 0% 40%)' : 'hsl(0 0% 25%)'};
      border-radius: 8px;
      padding: 1rem;
      margin: 0.5rem 0;
      cursor: pointer;
      transition: all 0.2s;
      ${config.layout === 'dashboard' ? 'box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);' : ''}
    }

    .item-card:hover {
      border-color: ${colors.primary};
      background: ${colors.primary.replace('60%)', '60% / 0.1)')};
    }

    ${config.enableCustomCSS && config.customCSS ? config.customCSS : ''}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.appTitle || `AgentDB ${exampleType.charAt(0).toUpperCase() + exampleType.slice(1)} Example`}</title>
  <style>${styles}
  </style>
</head>
<body>
${config.logoUrl ? `  <div class="container"><img src="${config.logoUrl}" alt="Logo" class="logo" /></div>` : ''}
${exampleHTML}

  <script type="module">
    import { SQLiteVectorDB } from 'https://unpkg.com/agentdb@1.3.9/dist/agentdb.min.js';
    ${exampleCode}
  </script>
</body>
</html>`;
  };

  const copyCode = () => {
    const code = generateCode();
    navigator.clipboard.writeText(code);
    toast({
      title: "Copied to clipboard",
      description: "Complete HTML code copied successfully",
    });
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold mb-4 text-cyan">Step 1: Database Configuration</h3>
              <p className="text-muted-foreground mb-6">Configure the core database settings</p>
            </div>

            {/* What This Wizard Does */}
            <Card className="bg-gradient-to-r from-cyan/10 to-purple-500/10 border-cyan/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-cyan" />
                  What This Wizard Creates
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-3">
                <p>
                  This wizard generates <strong className="text-foreground">production-ready, fully functional code</strong> that runs 100% in your browser using AgentDB's WebAssembly backend.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                  <div className="flex items-start gap-2">
                    <span className="text-cyan text-lg">✓</span>
                    <div>
                      <strong className="text-foreground">Complete HTML File</strong>
                      <p className="text-xs">Self-contained, no external dependencies</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-cyan text-lg">✓</span>
                    <div>
                      <strong className="text-foreground">Vector Database</strong>
                      <p className="text-xs">AgentDB with your exact configuration</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-cyan text-lg">✓</span>
                    <div>
                      <strong className="text-foreground">Interactive UI</strong>
                      <p className="text-xs">Ready-to-use interface with examples</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <span className="text-cyan text-lg">✓</span>
                    <div>
                      <strong className="text-foreground">Deploy Anywhere</strong>
                      <p className="text-xs">Static hosting, CDN, or edge workers</p>
                    </div>
                  </div>
                </div>

                <div className="bg-background/50 p-3 rounded border border-border mt-3">
                  <p className="text-xs">
                    <strong className="text-foreground">💡 Pro Tip:</strong> The generated code is meant to be customized!
                    Use it as a starting point for your production application. All examples include real embeddings,
                    search functionality, and are ready to integrate with your existing systems.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Configuration Presets */}
            <Card className="bg-gradient-to-r from-purple-500/10 to-cyan/10 border-purple-500/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-400" />
                  Quick Presets
                </CardTitle>
                <CardDescription>Start with optimized configurations for common use cases</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset('fast')}
                    className="hover:bg-cyan/10 hover:border-cyan"
                  >
                    <Zap className="h-3 w-3 mr-2" />
                    ⚡ Fast & Simple
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset('balanced')}
                    className="hover:bg-cyan/10 hover:border-cyan"
                  >
                    <Gauge className="h-3 w-3 mr-2" />
                    ⚖️ Balanced
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset('accurate')}
                    className="hover:bg-cyan/10 hover:border-cyan"
                  >
                    <Check className="h-3 w-3 mr-2" />
                    🎯 High Accuracy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset('memory-efficient')}
                    className="hover:bg-cyan/10 hover:border-cyan"
                  >
                    <MemoryStick className="h-3 w-3 mr-2" />
                    💾 Memory Efficient
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <div>
                <Label className="text-foreground">Backend</Label>
                <RadioGroup value={config.backend} onValueChange={(v) => updateConfig({ backend: v as 'wasm' | 'native' })}>
                  <div className="flex items-center space-x-2 mt-2">
                    <RadioGroupItem value="wasm" id="wasm" />
                    <Label htmlFor="wasm" className="cursor-pointer">WASM (Browser)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="native" id="native" />
                    <Label htmlFor="native" className="cursor-pointer">Native (Node.js only)</Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="memoryMode"
                  checked={config.memoryMode}
                  onCheckedChange={(checked) => updateConfig({ memoryMode: checked as boolean })}
                />
                <Label htmlFor="memoryMode" className="cursor-pointer">
                  In-Memory Database (no persistence)
                </Label>
              </div>

              <div>
                <Label htmlFor="dimensions" className="text-foreground">Vector Dimensions</Label>
                <Input
                  id="dimensions"
                  type="number"
                  value={config.dimensions}
                  onChange={(e) => updateConfig({ dimensions: parseInt(e.target.value) || 384 })}
                  className="mt-2"
                  min="1"
                  max="2048"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Common: 384 (MiniLM), 768 (BERT), 1536 (OpenAI)
                </p>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold mb-4 text-cyan">Step 2: Example Type & Configuration</h3>
              <p className="text-muted-foreground mb-6">Choose a practical use case with production-ready code</p>
            </div>

            {/* Basic Examples */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">🎯 Basic Examples</CardTitle>
                <CardDescription>Learn core AgentDB concepts</CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={config.exampleType}
                  onValueChange={(v) => updateConfig({ exampleType: v as any })}
                  className="space-y-3"
                >
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="simple" id="simple" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="simple" className="cursor-pointer font-semibold">Simple Insert & Search</Label>
                      <p className="text-xs text-muted-foreground mt-1">Basic vector operations • Great for learning</p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="semantic-search" id="semantic-search" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="semantic-search" className="cursor-pointer font-semibold">Semantic Search</Label>
                      <p className="text-xs text-muted-foreground mt-1">Interactive text search • Real-time indexing</p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="clustering" id="clustering" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="clustering" className="cursor-pointer font-semibold">Clustering & Visualization</Label>
                      <p className="text-xs text-muted-foreground mt-1">K-means clustering • Visual grouping demo</p>
                    </div>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Business Applications */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">💼 Business Applications</CardTitle>
                <CardDescription>Production-ready examples for real deployments</CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={config.exampleType}
                  onValueChange={(v) => updateConfig({ exampleType: v as any })}
                  className="space-y-3"
                >
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="ecommerce-search" id="ecommerce-search" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="ecommerce-search" className="cursor-pointer font-semibold">E-commerce Product Search</Label>
                      <p className="text-xs text-muted-foreground mt-1">Smart product discovery • Multi-attribute filtering • Deploy: Shopify, WooCommerce</p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="customer-support" id="customer-support" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="customer-support" className="cursor-pointer font-semibold">Customer Support Assistant</Label>
                      <p className="text-xs text-muted-foreground mt-1">FAQ matching • Ticket routing • Deploy: Help desk, Zendesk integration</p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="recommendation-system" id="recommendation-system" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="recommendation-system" className="cursor-pointer font-semibold">Content Recommendation Engine</Label>
                      <p className="text-xs text-muted-foreground mt-1">Personalized suggestions • Collaborative filtering • Deploy: Media sites, E-learning</p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="duplicate-detection" id="duplicate-detection" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="duplicate-detection" className="cursor-pointer font-semibold">Duplicate Content Detection</Label>
                      <p className="text-xs text-muted-foreground mt-1">Find near-duplicates • Content moderation • Deploy: CMS, Forums</p>
                    </div>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* AI & ML Applications */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">🤖 AI & ML Applications</CardTitle>
                <CardDescription>Advanced machine learning use cases</CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={config.exampleType}
                  onValueChange={(v) => updateConfig({ exampleType: v as any })}
                  className="space-y-3"
                >
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="rag" id="rag" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="rag" className="cursor-pointer font-semibold">RAG (Retrieval Augmented Generation)</Label>
                      <p className="text-xs text-muted-foreground mt-1">Document Q&A • Context retrieval • Deploy: Chatbots, Documentation</p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="text-classification" id="text-classification" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="text-classification" className="cursor-pointer font-semibold">Text Classification</Label>
                      <p className="text-xs text-muted-foreground mt-1">Multi-class categorization • Intent detection • Deploy: Email sorting, Content tagging</p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="sentiment-analysis" id="sentiment-analysis" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="sentiment-analysis" className="cursor-pointer font-semibold">Sentiment Analysis</Label>
                      <p className="text-xs text-muted-foreground mt-1">Review classification • Brand monitoring • Deploy: Social media, Customer feedback</p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="anomaly-detection" id="anomaly-detection" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="anomaly-detection" className="cursor-pointer font-semibold">Anomaly Detection</Label>
                      <p className="text-xs text-muted-foreground mt-1">Outlier identification • Fraud detection • Deploy: Security, Quality control</p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="fraud-detection" id="fraud-detection" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="fraud-detection" className="cursor-pointer font-semibold">Fraud Detection System</Label>
                      <p className="text-xs text-muted-foreground mt-1">Transaction monitoring • Pattern analysis • Deploy: FinTech, E-commerce</p>
                    </div>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Developer Tools */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">🛠️ Developer Tools</CardTitle>
                <CardDescription>Code-focused applications</CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={config.exampleType}
                  onValueChange={(v) => updateConfig({ exampleType: v as any })}
                  className="space-y-3"
                >
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="code-search" id="code-search" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="code-search" className="cursor-pointer font-semibold">Code Search Engine</Label>
                      <p className="text-xs text-muted-foreground mt-1">Semantic code search • Function finder • Deploy: Documentation, IDE plugins</p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="learning" id="learning" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="learning" className="cursor-pointer font-semibold">Pattern Learning & Prediction</Label>
                      <p className="text-xs text-muted-foreground mt-1">Adaptive learning • Behavior prediction • Deploy: Analytics, Automation</p>
                    </div>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Configuration Options */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">⚙️ Example Configuration</CardTitle>
                <CardDescription>Customize generated code for your needs</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="maxResults" className="text-foreground">Max Results</Label>
                    <Input
                      id="maxResults"
                      type="number"
                      value={config.maxResults}
                      onChange={(e) => updateConfig({ maxResults: parseInt(e.target.value) || 10 })}
                      className="mt-2"
                      min="1"
                      max="100"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Search result limit</p>
                  </div>

                  <div>
                    <Label htmlFor="similarityThreshold" className="text-foreground">Similarity Threshold</Label>
                    <Input
                      id="similarityThreshold"
                      type="number"
                      value={config.similarityThreshold}
                      onChange={(e) => updateConfig({ similarityThreshold: parseFloat(e.target.value) || 0.7 })}
                      className="mt-2"
                      min="0"
                      max="1"
                      step="0.05"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Minimum match score (0-1)</p>
                  </div>
                </div>

                {['text-classification', 'sentiment-analysis', 'fraud-detection'].includes(config.exampleType) && (
                  <div>
                    <Label htmlFor="numCategories" className="text-foreground">Number of Categories</Label>
                    <Input
                      id="numCategories"
                      type="number"
                      value={config.numCategories}
                      onChange={(e) => updateConfig({ numCategories: parseInt(e.target.value) || 4 })}
                      className="mt-2"
                      min="2"
                      max="20"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Classification classes</p>
                  </div>
                )}

                <div>
                  <Label className="text-foreground">Deployment Target</Label>
                  <RadioGroup
                    value={config.deploymentTarget}
                    onValueChange={(v) => updateConfig({ deploymentTarget: v as any })}
                    className="mt-2 grid grid-cols-2 gap-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="browser" id="browser-target" />
                      <Label htmlFor="browser-target" className="cursor-pointer">Browser (Static)</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="node" id="node-target" />
                      <Label htmlFor="node-target" className="cursor-pointer">Node.js Server</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="edge-worker" id="edge-target" />
                      <Label htmlFor="edge-target" className="cursor-pointer">Edge Worker</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="cloudflare" id="cloudflare-target" />
                      <Label htmlFor="cloudflare-target" className="cursor-pointer">Cloudflare Pages</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="space-y-3 pt-4 border-t border-border">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="enableRealtime"
                      checked={config.enableRealtime}
                      onCheckedChange={(checked) => updateConfig({ enableRealtime: checked as boolean })}
                    />
                    <Label htmlFor="enableRealtime" className="cursor-pointer">
                      Enable Real-time Updates
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includeUI"
                      checked={config.includeUI}
                      onCheckedChange={(checked) => updateConfig({ includeUI: checked as boolean })}
                    />
                    <Label htmlFor="includeUI" className="cursor-pointer">
                      Include UI Elements
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includeVisualization"
                      checked={config.includeVisualization}
                      onCheckedChange={(checked) => updateConfig({ includeVisualization: checked as boolean })}
                    />
                    <Label htmlFor="includeVisualization" className="cursor-pointer">
                      Include Visualization (where applicable)
                    </Label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold mb-4 text-cyan">Step 3: Advanced Configuration</h3>
              <p className="text-muted-foreground mb-6">Customize search, coordination, and code generation</p>
            </div>

            {/* HNSW Index Configuration */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enableHNSW"
                    checked={config.enableHNSW}
                    onCheckedChange={(checked) => updateConfig({ enableHNSW: checked as boolean })}
                  />
                  <CardTitle className="text-base">HNSW Index</CardTitle>
                </div>
                <CardDescription>Fast approximate nearest neighbor search</CardDescription>
              </CardHeader>
              {config.enableHNSW && (
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="M" className="text-foreground">M (Connections)</Label>
                      <Input
                        id="M"
                        type="number"
                        value={config.M}
                        onChange={(e) => updateConfig({ M: parseInt(e.target.value) || 16 })}
                        className="mt-2"
                        min="4"
                        max="64"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Default: 16</p>
                    </div>

                    <div>
                      <Label htmlFor="maxM0" className="text-foreground">maxM0 (Layer 0)</Label>
                      <Input
                        id="maxM0"
                        type="number"
                        value={config.maxM0}
                        onChange={(e) => updateConfig({ maxM0: parseInt(e.target.value) || 32 })}
                        className="mt-2"
                        min="8"
                        max="128"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Default: 32</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="efConstruction" className="text-foreground">efConstruction</Label>
                      <Input
                        id="efConstruction"
                        type="number"
                        value={config.efConstruction}
                        onChange={(e) => updateConfig({ efConstruction: parseInt(e.target.value) || 200 })}
                        className="mt-2"
                        min="50"
                        max="1000"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Build quality</p>
                    </div>

                    <div>
                      <Label htmlFor="efSearch" className="text-foreground">efSearch</Label>
                      <Input
                        id="efSearch"
                        type="number"
                        value={config.efSearch}
                        onChange={(e) => updateConfig({ efSearch: parseInt(e.target.value) || 50 })}
                        className="mt-2"
                        min="10"
                        max="500"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Query quality</p>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Distance Metric & Performance */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Distance Metric & Performance</CardTitle>
                <CardDescription>Optimize search behavior</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-foreground">Distance Metric</Label>
                  <RadioGroup
                    value={config.distanceMetric}
                    onValueChange={(v) => updateConfig({ distanceMetric: v as any })}
                    className="mt-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="cosine" id="cosine" />
                      <Label htmlFor="cosine" className="cursor-pointer flex items-center gap-2">
                        Cosine Similarity
                        <Badge variant="outline" className="bg-cyan/20 text-cyan border-cyan text-xs">RECOMMENDED</Badge>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="euclidean" id="euclidean" />
                      <Label htmlFor="euclidean" className="cursor-pointer">Euclidean Distance (L2)</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="dot" id="dot" />
                      <Label htmlFor="dot" className="cursor-pointer">Dot Product</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center space-x-2 mb-2">
                      <Checkbox
                        id="enableCache"
                        checked={config.enableCache}
                        onCheckedChange={(checked) => updateConfig({ enableCache: checked as boolean })}
                      />
                      <Label htmlFor="enableCache" className="cursor-pointer">Enable Cache</Label>
                    </div>
                    {config.enableCache && (
                      <>
                        <Input
                          type="number"
                          value={config.cacheSize}
                          onChange={(e) => updateConfig({ cacheSize: parseInt(e.target.value) || 1000 })}
                          min="100"
                          max="10000"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Cache size: {config.cacheSize}</p>
                      </>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="batchSize" className="text-foreground">Batch Size</Label>
                    <Input
                      id="batchSize"
                      type="number"
                      value={config.batchSize}
                      onChange={(e) => updateConfig({ batchSize: parseInt(e.target.value) || 100 })}
                      className="mt-2"
                      min="10"
                      max="1000"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Insert batching</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Swarm & Multi-Agent Coordination */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enableSwarm"
                    checked={config.enableSwarm}
                    onCheckedChange={(checked) => updateConfig({ enableSwarm: checked as boolean })}
                  />
                  <CardTitle className="text-base">Swarm Coordination</CardTitle>
                </div>
                <CardDescription>Multi-agent parallel processing</CardDescription>
              </CardHeader>
              {config.enableSwarm && (
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-foreground">Swarm Topology</Label>
                    <RadioGroup
                      value={config.swarmTopology}
                      onValueChange={(v) => updateConfig({ swarmTopology: v as any })}
                      className="mt-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="mesh" id="mesh" />
                        <Label htmlFor="mesh" className="cursor-pointer">Mesh (Peer-to-Peer)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="hierarchical" id="hierarchical" />
                        <Label htmlFor="hierarchical" className="cursor-pointer">Hierarchical (Tree)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="ring" id="ring" />
                        <Label htmlFor="ring" className="cursor-pointer">Ring (Circular)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="star" id="star" />
                        <Label htmlFor="star" className="cursor-pointer">Star (Centralized)</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div>
                    <Label htmlFor="maxAgents" className="text-foreground">Max Agents</Label>
                    <Input
                      id="maxAgents"
                      type="number"
                      value={config.maxAgents}
                      onChange={(e) => updateConfig({ maxAgents: parseInt(e.target.value) || 5 })}
                      className="mt-2"
                      min="1"
                      max="20"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Parallel agent workers</p>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Hive Mind / Distributed Processing */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enableHiveMind"
                    checked={config.enableHiveMind}
                    onCheckedChange={(checked) => updateConfig({ enableHiveMind: checked as boolean })}
                  />
                  <CardTitle className="text-base">Hive Mind (Distributed)</CardTitle>
                </div>
                <CardDescription>Fault-tolerant distributed consensus</CardDescription>
              </CardHeader>
              {config.enableHiveMind && (
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-foreground">Consensus Protocol</Label>
                    <RadioGroup
                      value={config.consensusProtocol}
                      onValueChange={(v) => updateConfig({ consensusProtocol: v as any })}
                      className="mt-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="raft" id="raft" />
                        <Label htmlFor="raft" className="cursor-pointer">Raft (Leader-based)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="gossip" id="gossip" />
                        <Label htmlFor="gossip" className="cursor-pointer">Gossip (Eventually Consistent)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="byzantine" id="byzantine" />
                        <Label htmlFor="byzantine" className="cursor-pointer">Byzantine Fault Tolerant</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div>
                    <Label htmlFor="replicationFactor" className="text-foreground">Replication Factor</Label>
                    <Input
                      id="replicationFactor"
                      type="number"
                      value={config.replicationFactor}
                      onChange={(e) => updateConfig({ replicationFactor: parseInt(e.target.value) || 3 })}
                      className="mt-2"
                      min="1"
                      max="7"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Number of data replicas</p>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Code Generation Options */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enableCodeGen"
                    checked={config.enableCodeGen}
                    onCheckedChange={(checked) => updateConfig({ enableCodeGen: checked as boolean })}
                  />
                  <CardTitle className="text-base">Advanced Code Generation</CardTitle>
                </div>
                <CardDescription>Customize generated code output</CardDescription>
              </CardHeader>
              {config.enableCodeGen && (
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-foreground">Code Style</Label>
                    <RadioGroup
                      value={config.codeStyle}
                      onValueChange={(v) => updateConfig({ codeStyle: v as any })}
                      className="mt-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="typescript" id="typescript" />
                        <Label htmlFor="typescript" className="cursor-pointer">TypeScript (Type-safe)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="javascript" id="javascript" />
                        <Label htmlFor="javascript" className="cursor-pointer">JavaScript (ES6+)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="python" id="python" />
                        <Label htmlFor="python" className="cursor-pointer">Python (Coming Soon)</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includeComments"
                      checked={config.includeComments}
                      onCheckedChange={(checked) => updateConfig({ includeComments: checked as boolean })}
                    />
                    <Label htmlFor="includeComments" className="cursor-pointer">Include detailed comments</Label>
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold mb-4 text-cyan">Step 4: Quantization (Optional)</h3>
              <p className="text-muted-foreground mb-6">Compress vectors to reduce memory usage</p>
            </div>

            <div className="flex items-center space-x-2 mb-4">
              <Checkbox
                id="enableQuantization"
                checked={config.enableQuantization}
                onCheckedChange={(checked) => updateConfig({ enableQuantization: checked as boolean })}
              />
              <Label htmlFor="enableQuantization" className="cursor-pointer font-semibold">
                Enable Quantization
              </Label>
            </div>

            {config.enableQuantization && (
              <div className="space-y-4">
                <div>
                  <Label className="text-foreground">Quantization Method</Label>
                  <RadioGroup
                    value={config.quantizationType}
                    onValueChange={(v) => updateConfig({ quantizationType: v as any })}
                    className="mt-2"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start space-x-2">
                        <RadioGroupItem value="scalar" id="scalar-step4" className="mt-1" />
                        <div className="flex-1">
                          <Label htmlFor="scalar-step4" className="cursor-pointer flex items-center gap-2">
                            Scalar Quantization
                            <Badge variant="outline" className="bg-cyan/20 text-cyan border-cyan text-xs">RECOMMENDED</Badge>
                          </Label>
                          <p className="text-xs text-muted-foreground mt-1">4-16x compression, 85-95% accuracy</p>
                        </div>
                      </div>

                      <div className="flex items-start space-x-2">
                        <RadioGroupItem value="product" id="product-step4" className="mt-1" />
                        <div className="flex-1">
                          <Label htmlFor="product-step4" className="cursor-pointer">Product Quantization (PQ)</Label>
                          <p className="text-xs text-muted-foreground mt-1">16-64x compression, 70-85% accuracy</p>
                        </div>
                      </div>

                      <div className="flex items-start space-x-2">
                        <RadioGroupItem value="binary" id="binary-step4" className="mt-1" />
                        <div className="flex-1">
                          <Label htmlFor="binary-step4" className="cursor-pointer">Binary Quantization</Label>
                          <p className="text-xs text-muted-foreground mt-1">256x compression, 60-75% accuracy (fastest)</p>
                        </div>
                      </div>

                      <div className="flex items-start space-x-2">
                        <RadioGroupItem value="optimized-pq" id="optimized-pq-step4" className="mt-1" />
                        <div className="flex-1">
                          <Label htmlFor="optimized-pq-step4" className="cursor-pointer">Optimized PQ (OPQ)</Label>
                          <p className="text-xs text-muted-foreground mt-1">16-64x compression, 75-90% accuracy</p>
                        </div>
                      </div>
                    </div>
                  </RadioGroup>
                </div>

                {config.quantizationType === 'scalar' && (
                  <div>
                    <Label className="text-foreground">Quantization Bits</Label>
                    <RadioGroup
                      value={config.quantizationBits.toString()}
                      onValueChange={(v) => updateConfig({ quantizationBits: parseInt(v) as 8 | 16 })}
                      className="mt-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="8" id="8bit-step4" />
                        <Label htmlFor="8bit-step4" className="cursor-pointer">8-bit (4x compression)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="16" id="16bit-step4" />
                        <Label htmlFor="16bit-step4" className="cursor-pointer">16-bit (2x compression, better accuracy)</Label>
                      </div>
                    </RadioGroup>
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case 5:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold mb-4 text-cyan">Step 5: UI Customization</h3>
              <p className="text-muted-foreground mb-6">Customize the look and feel of your generated code</p>
            </div>

            {/* Color Scheme */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">🎨 Color Scheme</CardTitle>
                <CardDescription>Choose a color theme for your application</CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={config.colorScheme || 'default'}
                  onValueChange={(v) => updateConfig({ colorScheme: v as any })}
                  className="space-y-3"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="default" id="color-default" />
                    <Label htmlFor="color-default" className="cursor-pointer">Default (Cyan & Purple)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="blue" id="color-blue" />
                    <Label htmlFor="color-blue" className="cursor-pointer">Blue Professional</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="green" id="color-green" />
                    <Label htmlFor="color-green" className="cursor-pointer">Green Nature</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="orange" id="color-orange" />
                    <Label htmlFor="color-orange" className="cursor-pointer">Orange Energy</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="dark" id="color-dark" />
                    <Label htmlFor="color-dark" className="cursor-pointer">Dark Mode</Label>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Layout Options */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">📐 Layout</CardTitle>
                <CardDescription>Choose how content is organized</CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={config.layout || 'single'}
                  onValueChange={(v) => updateConfig({ layout: v as any })}
                  className="space-y-3"
                >
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="single" id="layout-single" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="layout-single" className="cursor-pointer font-semibold">Single Column</Label>
                      <p className="text-xs text-muted-foreground mt-1">Clean, focused layout perfect for demos</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="two-column" id="layout-two" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="layout-two" className="cursor-pointer font-semibold">Two Column</Label>
                      <p className="text-xs text-muted-foreground mt-1">Input on left, results on right</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="dashboard" id="layout-dashboard" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="layout-dashboard" className="cursor-pointer font-semibold">Dashboard</Label>
                      <p className="text-xs text-muted-foreground mt-1">Cards with stats and visualizations</p>
                    </div>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Font & Accessibility */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">♿ Accessibility</CardTitle>
                <CardDescription>Font and accessibility options</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="fontSize" className="text-foreground">Base Font Size</Label>
                  <RadioGroup
                    value={config.fontSize || 'medium'}
                    onValueChange={(v) => updateConfig({ fontSize: v as any })}
                    className="mt-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="small" id="font-small" />
                      <Label htmlFor="font-small" className="cursor-pointer">Small (14px)</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="medium" id="font-medium" />
                      <Label htmlFor="font-medium" className="cursor-pointer">Medium (16px)</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="large" id="font-large" />
                      <Label htmlFor="font-large" className="cursor-pointer">Large (18px)</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="highContrast"
                    checked={config.highContrast || false}
                    onCheckedChange={(checked) => updateConfig({ highContrast: checked as boolean })}
                  />
                  <Label htmlFor="highContrast" className="cursor-pointer">
                    High Contrast Mode
                  </Label>
                </div>
              </CardContent>
            </Card>

            {/* Branding */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">🏷️ Branding (Optional)</CardTitle>
                <CardDescription>Add your own branding to the generated code</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="appTitle" className="text-foreground">Application Title</Label>
                  <Input
                    id="appTitle"
                    type="text"
                    placeholder="My AgentDB App"
                    value={config.appTitle || ''}
                    onChange={(e) => updateConfig({ appTitle: e.target.value })}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="logoUrl" className="text-foreground">Logo URL (optional)</Label>
                  <Input
                    id="logoUrl"
                    type="text"
                    placeholder="https://example.com/logo.png"
                    value={config.logoUrl || ''}
                    onChange={(e) => updateConfig({ logoUrl: e.target.value })}
                    className="mt-2"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Provide a URL to your logo image</p>
                </div>
              </CardContent>
            </Card>

            {/* Custom CSS */}
            <Card className="bg-panel border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">💅 Custom CSS (Advanced)</CardTitle>
                <CardDescription>Inject custom styles into your generated code</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-2 mb-3">
                  <Checkbox
                    id="enableCustomCSS"
                    checked={config.enableCustomCSS || false}
                    onCheckedChange={(checked) => updateConfig({ enableCustomCSS: checked as boolean })}
                  />
                  <Label htmlFor="enableCustomCSS" className="cursor-pointer font-semibold">
                    Enable Custom CSS
                  </Label>
                </div>

                {config.enableCustomCSS && (
                  <textarea
                    className="w-full h-32 p-3 rounded border border-border bg-background font-mono text-sm"
                    placeholder=".my-custom-class { color: #00d4ff; }"
                    value={config.customCSS || ''}
                    onChange={(e) => updateConfig({ customCSS: e.target.value })}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        );

      case 6:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold mb-4 text-cyan">Step 6: Preview & Copy Code</h3>
              <p className="text-muted-foreground mb-6">Your complete AgentDB example is ready!</p>
            </div>

            <Card className="bg-panel border-border">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Configuration Summary</span>
                  <Badge variant="secondary">{config.exampleType}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <div className="flex justify-between">
                  <span>Backend:</span>
                  <span className="text-cyan">{config.backend.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Memory Mode:</span>
                  <span className="text-cyan">{config.memoryMode ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Dimensions:</span>
                  <span className="text-cyan">{config.dimensions}</span>
                </div>
                {config.enableQuantization && (
                  <div className="flex justify-between">
                    <span>Quantization:</span>
                    <span className="text-cyan">{config.quantizationType}</span>
                  </div>
                )}
                {config.enableHNSW && (
                  <div className="flex justify-between">
                    <span>HNSW Index:</span>
                    <span className="text-cyan">M={config.M}, ef={config.efSearch}</span>
                  </div>
                )}

                {/* UI Customization Settings */}
                <div className="border-t border-border pt-2 mt-2">
                  <div className="text-xs font-semibold text-foreground mb-2">UI Customization</div>

                  <div className="flex justify-between">
                    <span>Color Scheme:</span>
                    <span className="text-cyan capitalize">{config.colorScheme || 'default'}</span>
                  </div>

                  <div className="flex justify-between">
                    <span>Layout:</span>
                    <span className="text-cyan capitalize">{(config.layout || 'single').replace('-', ' ')}</span>
                  </div>

                  <div className="flex justify-between">
                    <span>Font Size:</span>
                    <span className="text-cyan capitalize">{config.fontSize || 'medium'}</span>
                  </div>

                  {config.highContrast && (
                    <div className="flex justify-between">
                      <span>High Contrast:</span>
                      <span className="text-cyan">Enabled</span>
                    </div>
                  )}

                  {config.appTitle && (
                    <div className="flex justify-between">
                      <span>App Title:</span>
                      <span className="text-cyan truncate ml-2 max-w-[200px]" title={config.appTitle}>
                        {config.appTitle}
                      </span>
                    </div>
                  )}

                  {config.logoUrl && (
                    <div className="flex justify-between">
                      <span>Logo:</span>
                      <span className="text-cyan">✓ Included</span>
                    </div>
                  )}

                  {config.enableCustomCSS && config.customCSS && (
                    <div className="flex justify-between">
                      <span>Custom CSS:</span>
                      <span className="text-cyan">{config.customCSS.split('\n').length} lines</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Performance Estimates */}
            <Card className="bg-panel border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-cyan" />
                  Performance Estimates
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                {(() => {
                  const perf = calculatePerformance();
                  return (
                    <>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-2">
                          <Clock className="h-3 w-3" />
                          Search Speed:
                        </span>
                        <Badge variant="outline" className="text-cyan border-cyan">
                          {perf.searchSpeed}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-2">
                          <MemoryStick className="h-3 w-3" />
                          Memory Usage:
                        </span>
                        <Badge variant="outline" className="text-cyan border-cyan">
                          {perf.memoryUsage}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-2">
                          <Check className="h-3 w-3" />
                          Accuracy:
                        </span>
                        <Badge variant="outline" className="text-cyan border-cyan">
                          {perf.accuracy}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-2">
                          <Zap className="h-3 w-3" />
                          Compression:
                        </span>
                        <Badge variant="outline" className="text-cyan border-cyan">
                          {perf.compressionRatio}
                        </Badge>
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Button
                onClick={() => setShowPreview(!showPreview)}
                variant="outline"
                className="col-span-2 md:col-span-1"
              >
                <Eye className="h-4 w-4 mr-2" />
                {showPreview ? 'Hide' : 'Show'} Preview
              </Button>
              <Button
                onClick={downloadCode}
                className="col-span-1 bg-purple-500 hover:bg-purple-600"
              >
                <Download className="h-4 w-4 mr-2" />
                Download HTML
              </Button>
              <Button
                onClick={downloadDatabase}
                className="col-span-1 bg-orange-500 hover:bg-orange-600"
              >
                <Database className="h-4 w-4 mr-2" />
                Download DB
              </Button>
              <Button
                onClick={copyCode}
                className="col-span-2 md:col-span-1 bg-cyan hover:bg-cyan/90"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy Code
              </Button>
            </div>

            {showPreview && (
              <div className="border border-border rounded-lg overflow-hidden">
                <iframe
                  srcDoc={generateCode()}
                  className="w-full h-96 bg-background"
                  title="Preview"
                  sandbox="allow-scripts"
                />
              </div>
            )}

            <Card className="bg-cyan/10 border-cyan/30">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-cyan flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-foreground mb-2">Next Steps</h4>
                    <ul className="text-sm text-foreground space-y-1">
                      <li>• Save the code as an HTML file</li>
                      <li>• Open it in your browser to test</li>
                      <li>• Customize the example for your use case</li>
                      <li>• Explore other AgentDB features in the docs</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] p-0 flex flex-col bg-background border-border">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b border-border flex-shrink-0">
          <DialogTitle className="text-2xl font-bold text-cyan flex items-center gap-2">
            <Wand2 className="h-6 w-6" />
            AgentDB Code Wizard
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Generate a complete AgentDB WASM example in 6 easy steps
          </p>
        </DialogHeader>

        {/* Progress */}
        <div className="px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
              <div key={s} className="flex items-center flex-1">
                <button
                  onClick={() => goToStep(s)}
                  disabled={s > step}
                  className={`
                    flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all
                    ${s < step ? 'bg-cyan border-cyan text-background cursor-pointer hover:bg-cyan/90' : ''}
                    ${s === step ? 'border-cyan text-cyan' : ''}
                    ${s > step ? 'border-border text-muted-foreground cursor-not-allowed' : ''}
                    ${s <= step && s !== step ? 'hover:scale-110' : ''}
                  `}
                  title={s <= step ? `Go to step ${s}` : `Complete step ${step} first`}
                >
                  {s < step ? <Check className="h-4 w-4" /> : s}
                </button>
                {s < totalSteps && (
                  <div className={`flex-1 h-0.5 mx-2 ${s < step ? 'bg-cyan' : 'bg-border'}`} />
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-3 w-3" />
            <span>Step {step} of {totalSteps} • Click step numbers to navigate back</span>
          </div>
        </div>

        {/* Scrollable Content Area */}
        <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
          {renderStep()}
        </div>

        {/* Sticky Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between flex-shrink-0 bg-background">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={step === 1}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous
          </Button>

          <div className="flex gap-2">
            {step < totalSteps ? (
              <Button
                onClick={nextStep}
                className="bg-cyan hover:bg-cyan/90"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={() => onOpenChange(false)}
                variant="outline"
              >
                Close
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
