/**
 * WASM Examples Data Repository
 * Complete catalog of all 26 AgentDB WASM examples
 */

import type { WasmExample, LearningCategory, DifficultyLevel, LearningType, FilterState } from '@/types/wasm-examples';

/**
 * Complete catalog of WASM examples
 */
export const WASM_EXAMPLES: WasmExample[] = [
  {
    id: 'neural-trading',
    title: 'Neural Trading System',
    subtitle: 'Multi-Source AI Trading with GOAP & SAFLA',
    description:
      'Advanced AI trading system combining GOAP (Goal-Oriented Action Planning), SAFLA (Self-Aware Feedback Loop Algorithm), and AgentDB vector learning. Integrates real-time stock feeds, social sentiment analysis, and Polymarket prediction data. Features intelligent action planning with A* search, self-aware reinforcement learning that adapts strategies based on performance feedback, and Gemini AI for market analysis. Stores successful trading patterns in AgentDB vector database for pattern-based decision making. Fully configurable with realistic simulation - easily replace with real API feeds.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'reinforcement',
    htmlPath: '/demo/neural-trading',
    icon: 'TrendingUp',
    gradient: ['#22c55e', '#06b6d4'],
    features: [
      'GOAP action planning (A* search)',
      'SAFLA self-aware learning',
      'Multi-source data fusion',
      'AgentDB pattern storage',
      'Gemini AI analysis',
      'Real-time portfolio tracking',
    ],
    useCases: [
      'Algorithmic trading systems',
      'Multi-source decision making',
      'Adaptive strategy optimization',
      'Market sentiment analysis',
    ],
    algorithms: ['GOAP', 'SAFLA', 'Reinforcement Learning', 'Vector Search', 'Sentiment Analysis'],
    popularity: 98,
  },
  {
    id: 'autonomous-training',
    title: 'Autonomous Training System',
    subtitle: 'Multi-Agent ML Training with ReasoningBank',
    description:
      'Revolutionary autonomous ML training system powered by 5 specialized agents working in parallel: Data Preparation (preprocessing), Hyperparameter Tuner (optimization), Model Trainer (backpropagation), Validator (cross-validation), and Performance Optimizer (efficiency). Features ReasoningBank pattern learning that stores successful hyperparameter configurations in AgentDB\'s vector database, enabling the system to learn optimal settings from experience. Trains 4 ML models concurrently (Neural Network, Linear Regression, Decision Tree, K-Means) with real-time progress visualization, automatic pattern retrieval, and Gemini AI coordination for intelligent optimization strategies.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/autonomous-training/index.html',
    icon: 'Bot',
    gradient: ['#8b5cf6', '#06b6d4'],
    features: [
      '5 concurrent training agents',
      'ReasoningBank hyperparameter learning',
      '4 ML models parallel training',
      'Real-time metrics dashboard',
      'Gemini AI optimization',
    ],
    useCases: [
      'AutoML systems',
      'Hyperparameter optimization',
      'Distributed ML training',
      'Pattern-based tuning',
    ],
    algorithms: ['Neural Networks', 'Linear Regression', 'Decision Trees', 'K-Means Clustering'],
    popularity: 100,
  },
  {
    id: 'autonomous-research',
    title: 'Autonomous Research Assistant',
    subtitle: 'AI-Powered Research Synthesis with Self-Learning',
    description:
      'Advanced research assistant that autonomously learns from your queries and builds a comprehensive knowledge graph. Powered by Gemini AI for intelligent synthesis of complex information, it extracts concepts, discovers relationships, and generates insights with increasing accuracy. Features real-time learning visualization, semantic search across stored knowledge, and autonomous pattern recognition that improves research quality over time.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/autonomous-research/index.html',
    icon: 'Search',
    gradient: ['#06b6d4', '#8b5cf6'],
    features: [
      'Gemini AI research synthesis',
      'Self-learning from patterns',
      'Knowledge graph building',
      'Vector-based semantic search',
      'Autonomous insights generation',
    ],
    useCases: [
      'Academic research',
      'Market analysis',
      'Literature review',
      'Knowledge discovery',
    ],
    algorithms: ['Vector Similarity', 'Pattern Recognition', 'Semantic Search', 'Knowledge Graphs'],
    popularity: 98,
  },
  {
    id: 'intelligent-code-assistant',
    title: 'Autonomous Coding Swarm',
    subtitle: 'Multi-Agent Code Generation with ReasoningBank Learning',
    description:
      'Revolutionary autonomous coding system powered by 5 specialized AI agents working in parallel: Architect (designs structure), Coder (implements logic), Reviewer (validates quality), Optimizer (enhances performance), and Tester (ensures reliability). Features ReasoningBank pattern learning that stores successful approaches in AgentDB\'s vector database, allowing the swarm to learn from experience and retrieve similar patterns for future tasks. Watch real-time multi-step coordination as agents collaborate to generate production-ready code with Gemini AI assistance.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/intelligent-code-assistant/index.html',
    icon: 'Code',
    gradient: ['#3b82f6', '#06b6d4'],
    features: [
      '5 concurrent specialized agents',
      'ReasoningBank pattern learning',
      'Real-time swarm coordination',
      'Multi-step progress visualization',
      'Gemini AI code generation',
    ],
    useCases: [
      'Complex code generation',
      'Multi-agent coordination',
      'Pattern-based development',
      'Autonomous optimization',
    ],
    algorithms: ['Multi-Agent Systems', 'ReasoningBank', 'Vector Pattern Search', 'Swarm Intelligence'],
    popularity: 96,
  },
  {
    id: 'adaptive-content-curator',
    title: 'Adaptive Content Curator',
    subtitle: 'AI-Powered Personalized Content Discovery',
    description:
      'Intelligent content recommendation engine that runs entirely in your browser using AgentDB\'s vector database. Learns your content preferences through likes and dislikes, automatically discovers patterns in your interests, and continuously adapts recommendations in real-time. Uses collaborative filtering and content-based algorithms to surface relevant articles, with dynamic ranking that improves with each interaction. No server required - all learning happens locally.',
    category: 'standard',
    difficulty: 'intermediate',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/adaptive-content-curator/index.html',
    icon: 'Sparkles',
    gradient: ['#ec4899', '#8b5cf6'],
    features: [
      'Preference learning',
      'Dynamic content ranking',
      'Pattern-based recommendations',
      'Real-time adaptation',
      'Category discovery',
    ],
    useCases: [
      'Content feeds',
      'News aggregation',
      'Learning platforms',
      'Media discovery',
    ],
    algorithms: ['Collaborative Filtering', 'Preference Learning', 'Content-Based Filtering', 'Adaptive Ranking'],
    popularity: 92,
  },
  {
    id: 'smart-meeting-notes',
    title: 'Smart Meeting Notes',
    subtitle: 'AI-Powered Meeting Summarization & Action Extraction',
    description:
      'Professional meeting assistant powered by Gemini AI that transforms raw meeting transcripts into structured, actionable summaries. Automatically detects participants, extracts action items with assignees and deadlines, identifies key decisions, and generates executive summaries. Features intelligent parsing of discussion topics, next steps extraction, and comprehensive meeting insights. Learns from past meetings to improve accuracy and stores summaries in local vector database for semantic search.',
    category: 'standard',
    difficulty: 'intermediate',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/smart-meeting-notes/index.html',
    icon: 'FileText',
    gradient: ['#f59e0b', '#ef4444'],
    features: [
      'Gemini AI summarization',
      'Action item extraction',
      'Participant detection',
      'Key decision tracking',
      'Meeting insights',
    ],
    useCases: [
      'Meeting documentation',
      'Action tracking',
      'Team coordination',
      'Project management',
    ],
    algorithms: ['NLP', 'Named Entity Recognition', 'Text Summarization', 'Pattern Extraction'],
    popularity: 94,
  },
  {
    id: 'personal-knowledge-manager',
    title: 'Personal Knowledge Manager',
    subtitle: 'AI-Powered Knowledge Base with Semantic Search',
    description:
      'Comprehensive personal knowledge base with vector-powered semantic search and Gemini AI auto-tagging. Store notes, articles, and research with intelligent organization that goes beyond keyword matching. Features similarity-based content discovery, automatic tag generation, and smart categorization. Search using natural language to find conceptually related content even when exact keywords don\'t match. Perfect for researchers, students, and knowledge workers who need powerful local-first note organization.',
    category: 'standard',
    difficulty: 'intermediate',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/personal-knowledge-manager/index.html',
    icon: 'Brain',
    gradient: ['#10b981', '#06b6d4'],
    features: [
      'Vector semantic search',
      'Gemini AI auto-tagging',
      'Knowledge organization',
      'Similarity matching',
      'Tag-based filtering',
    ],
    useCases: [
      'Personal notes',
      'Research organization',
      'Documentation',
      'Learning management',
    ],
    algorithms: ['Vector Search', 'TF-IDF', 'Cosine Similarity', 'Auto-Categorization'],
    popularity: 90,
  },
  {
    id: 'reasoningbank-benchmark',
    title: 'ReasoningBank Performance Benchmark',
    subtitle: 'Pattern Learning with Measurable Improvement Tracking',
    description:
      'Comprehensive benchmark system that demonstrates ReasoningBank\'s pattern learning capabilities with detailed performance metrics and improvement tracking. Runs comparative benchmarks showing measurable improvements when using stored patterns vs baseline approaches. Features real-time learning curve visualization, success rate tracking across multiple runs, speed improvement measurements (typically 20-40% faster), and pattern quality analysis. Stores task patterns in AgentDB\'s vector database and retrieves similar patterns for future tasks, demonstrating concrete evidence of learning through performance gains. Includes detailed comparison tables showing before/after metrics, improvement badges, and multi-run trend analysis.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/reasoningbank-benchmark/index.html',
    icon: 'TrendingUp',
    gradient: ['#8b5cf6', '#ec4899'],
    features: [
      'Performance benchmarking',
      'Learning curve visualization',
      'Before/after comparisons',
      'Pattern quality metrics',
      'Multi-run trend analysis',
    ],
    useCases: [
      'Pattern learning validation',
      'Performance optimization',
      'ML improvement tracking',
      'Benchmark analysis',
    ],
    algorithms: ['ReasoningBank', 'Pattern Matching', 'Performance Analysis', 'Trend Detection'],
    popularity: 94,
  },
  {
    id: 'hivemind-coordination',
    title: 'Hivemind Coordination System',
    subtitle: 'Distributed AI Agents with Collective Intelligence',
    description:
      'Advanced distributed AI system featuring 6 autonomous agents (Queen Coordinator, Research Analyst, Strategy Planner, Execution Agent, Validation Agent, Learning Agent) working in hierarchical-mesh topology with shared collective memory. Demonstrates real-world hivemind architecture from claude-flow with consensus voting mechanisms, inter-agent communication, and distributed decision-making. Features live network topology visualization showing active agent connections, real-time message passing between agents, collective knowledge storage in AgentDB vector database, and Gemini AI-powered reasoning. Agents autonomously coordinate to solve complex multi-phase missions: research & analysis, strategy planning, consensus voting, execution, validation, and pattern learning. Watch as the hivemind achieves 95%+ consensus through collaborative intelligence and stores successful patterns for future missions.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/hivemind-coordination/index.html',
    icon: 'Network',
    gradient: ['#a78bfa', '#ec4899'],
    features: [
      '6-agent hierarchical coordination',
      'Consensus voting mechanism',
      'Collective memory sharing',
      'Real-time network topology',
      'Gemini AI agent reasoning',
    ],
    useCases: [
      'Distributed decision making',
      'Multi-agent coordination',
      'Consensus systems',
      'Swarm intelligence',
    ],
    algorithms: ['Hivemind Architecture', 'Consensus Voting', 'Vector Knowledge Sharing', 'Distributed Coordination'],
    popularity: 97,
  },
  {
    id: 'agentic-marketing',
    title: 'Agentic Marketing Intelligence',
    subtitle: 'ROAS-Optimized Meta Ads with SAFLA Learning',
    description:
      'Revolutionary autonomous marketing system that manages Meta Ads campaigns with AI-driven ROAS (Return On Ad Spend) optimization. Powered by ReasoningBank SAFLA (Self-Aware Feedback Loop Algorithm), this system continuously learns from campaign performance, automatically reallocating budgets to high-performing campaigns, running A/B tests across creative variants, and optimizing targeting with Gemini AI strategic insights. Features real-time campaign monitoring with 3 concurrent campaigns (E-commerce, Lead Gen, Brand Awareness), automatic budget reallocation based on performance metrics, A/B testing with variant comparison, pattern learning from successful strategies, and autonomous reinvestment logic. Watch as the system achieves 2-3x ROAS through intelligent optimization, stores winning strategies in vector database, and applies learned patterns to future campaigns. Includes comprehensive metrics dashboard tracking spend, revenue, CTR, CPC, conversions, and SAFLA loop iterations.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/agentic-marketing/index.html',
    icon: 'TrendingUp',
    gradient: ['#10b981', '#f59e0b'],
    features: [
      'ROAS-based budget optimization',
      'SAFLA continuous learning',
      'A/B testing automation',
      'Gemini AI strategic insights',
      'Meta Ads campaign simulation',
    ],
    useCases: [
      'Digital marketing automation',
      'Ad campaign optimization',
      'Budget allocation',
      'Performance marketing',
    ],
    algorithms: ['SAFLA Feedback Loops', 'ROAS Optimization', 'A/B Testing', 'Pattern-Based Allocation', 'Reinforcement Learning'],
    popularity: 99,
  },
  {
    id: 'strategic-battleship',
    title: 'Strategic AI Battleship',
    subtitle: 'Game Theory Naval Combat with Multi-Agent AI',
    description:
      'Advanced naval warfare simulation featuring three AI admirals using game theory, Bayesian targeting, and adaptive pattern learning. Watch autonomous agents battle using Nash Equilibrium ship placement, probability heatmaps, coalition formation, and adaptive strategy optimization. Features AgentDB v1.3.9 for pattern storage, real-time learning, and causal inference. Includes dramatic victory displays with bouncing crowns, achievement system tracking perfect games, and comprehensive statistics with color-coded admiral rankings. Each admiral employs unique strategies: Alpha uses aggressive Bayesian targeting, Beta forms coalitions, and Gamma adapts based on opponent behavior. Real-time scoreboard shows accuracy bars with shimmer effects and golden winner glow.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'reinforcement',
    htmlPath: '/agentdb/examples/browser/wargames/index.html',
    icon: 'Swords',
    gradient: ['#8b5cf6', '#ec4899'],
    features: [
      'Game theory AI (Nash Equilibrium, Prisoner\'s Dilemma)',
      'Bayesian inference targeting with probability heatmaps',
      'Real-time pattern learning & causal inference',
      'Multi-agent coordination with coalition formation',
      'AgentDB v1.3.9 vector storage for strategies',
      'Dynamic scoreboard with rankings and accuracy bars',
    ],
    useCases: [
      'Game theory demonstrations',
      'Multi-agent AI coordination systems',
      'Strategic decision-making research',
      'Pattern recognition and adaptive learning',
    ],
    algorithms: ['Nash Equilibrium', 'Bayesian Inference', 'Pattern Learning', 'Causal Inference', 'Coalition Formation', 'Probability Heat Maps'],
    popularity: 95,
  },
  {
    id: 'management-ide',
    title: 'AgentDB Management IDE',
    subtitle: 'Full-Featured Vector Database Management & Analytics',
    description:
      'Comprehensive browser-based IDE for managing AgentDB vector databases with advanced features for pattern learning, causal analysis, and optimization. Features include full CRUD operations on patterns, episodes, and trajectories; batch pattern import with duplicate detection and validation; vector search enhancement with similarity scoring; causal graph analysis showing pattern dependencies and impact flows; optimizer for database performance tuning; and comprehensive help system. Includes sample data loading for quick experimentation, export/import functionality, and real-time console logging. Perfect for data scientists, researchers, and AI developers who need powerful tools for managing vector-based learning systems and analyzing agent behaviors.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/management-ide/index.html',
    icon: 'Database',
    gradient: ['#6366f1', '#8b5cf6'],
    features: [
      'Full vector database management',
      'Batch pattern import/export',
      'Causal graph analysis',
      'Performance optimizer',
      'Vector search enhancement',
      'Real-time console logging',
    ],
    useCases: [
      'Database administration',
      'Pattern library management',
      'Causal analysis',
      'Performance optimization',
      'Agent behavior analysis',
    ],
    algorithms: ['Vector Search', 'Causal Graph Analysis', 'Pattern Matching', 'Database Optimization'],
    popularity: 95,
  },
  {
    id: 'rag-self-learning',
    title: 'RAG Self-Learning',
    subtitle: 'Retrieval-Augmented Generation with Continuous Learning',
    description:
      'Build a knowledge base that learns from user queries and feedback to improve responses over time.',
    category: 'standard',
    difficulty: 'intermediate',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/rag/index.html',
    icon: 'BookOpen',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Dynamic knowledge base',
      'Vector semantic search',
      'Query pattern recognition',
      'Feedback loop learning',
      'Context-aware responses',
    ],
    useCases: [
      'Personal knowledge management',
      'FAQ chatbots',
      'Document search systems',
      'Context-aware help systems',
    ],
    algorithms: ['Vector Similarity (Cosine)', 'TF-IDF Embeddings', 'Retrieval-Augmented Generation'],
    popularity: 95,
  },

  {
    id: 'pattern-learning',
    title: 'Pattern-Based Learning',
    subtitle: 'Discover and Predict User Interaction Patterns',
    description: 'Automatically detect behavioral patterns and provide predictive assistance.',
    category: 'standard',
    difficulty: 'beginner',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/pattern-learning/index.html',
    icon: 'TrendingUp',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Automatic pattern detection',
      'Confidence scoring',
      'Next-action prediction',
      'Temporal analysis',
      'Visual timeline',
    ],
    useCases: ['Workflow optimization', 'Predictive UI/UX', 'Task automation', 'Productivity apps'],
    algorithms: ['Sequence Mining', 'Sliding Window Analysis', 'Pattern Frequency Analysis'],
    popularity: 80,
  },

  {
    id: 'experience-replay',
    title: 'Experience Replay',
    subtitle: 'Q-Learning with Experience Buffer',
    description: 'Classic reinforcement learning with experience replay for optimal strategy discovery.',
    category: 'standard',
    difficulty: 'advanced',
    learningType: 'reinforcement',
    htmlPath: '/agentdb/examples/browser/experience-replay/index.html',
    icon: 'Brain',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Q-Learning algorithm',
      'Experience replay buffer',
      'Epsilon-greedy exploration',
      'Q-value visualization',
      'Auto-play training',
    ],
    useCases: ['Game AI', 'Resource allocation', 'Path planning', 'Decision systems'],
    algorithms: ['Q-Learning', 'Bellman Equation', 'Experience Replay', 'Epsilon-Greedy Policy'],
    popularity: 75,
  },

  {
    id: 'collaborative-filtering',
    title: 'Collaborative Filtering',
    subtitle: 'Recommendation System Based on User Similarity',
    description: 'Build recommendations by finding users with similar tastes.',
    category: 'standard',
    difficulty: 'intermediate',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/collaborative-filtering/index.html',
    icon: 'Users',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'User similarity calculation',
      'Item-based filtering',
      'Cold-start handling',
      'Multi-category support',
      'Cross-user patterns',
    ],
    useCases: ['Content recommendations', 'E-commerce suggestions', 'Friend recommendations', 'Media playlists'],
    algorithms: ['Cosine Similarity', 'K-Nearest Neighbors', 'Matrix Factorization'],
    popularity: 85,
  },

  {
    id: 'adaptive-recommendations',
    title: 'Adaptive Recommendations',
    subtitle: 'Multi-Armed Bandit with Thompson Sampling',
    description: 'Real-time adaptive system balancing exploration and exploitation.',
    category: 'standard',
    difficulty: 'advanced',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/adaptive-recommendations/index.html',
    icon: 'Zap',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Thompson Sampling',
      'Beta distribution tracking',
      'Real-time adaptation',
      'Exploration/exploitation balance',
      'Category preference tracking',
    ],
    useCases: ['Personalized feeds', 'A/B testing', 'Dynamic pricing', 'Adaptive marketing'],
    algorithms: ['Multi-Armed Bandit', 'Thompson Sampling', 'Beta Distribution', 'Bayesian Inference'],
    popularity: 70,
  },

  {
    id: 'swarm-intelligence',
    title: 'Swarm Intelligence',
    subtitle: 'Emergent Collective Behavior with PSO',
    description: 'Watch autonomous agents exhibit emergent intelligence through local interactions.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/swarm-intelligence/index.html',
    icon: 'Hexagon',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Particle swarm optimization',
      'Stigmergy communication',
      'Three behavior modes',
      'Emergent pathfinding',
      'Obstacle avoidance',
    ],
    useCases: ['Distributed optimization', 'Route planning', 'Swarm robotics', 'Network optimization'],
    algorithms: ['Particle Swarm Optimization', 'Stigmergy', 'Pheromone Trails', 'Swarm Coordination'],
    popularity: 60,
  },

  {
    id: 'meta-learning',
    title: 'Meta-Learning (MAML)',
    subtitle: 'Learning to Learn - Few-Shot Task Adaptation',
    description: 'Model-Agnostic Meta-Learning for rapid adaptation with minimal examples.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/meta-learning/index.html',
    icon: 'GitBranch',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'MAML algorithm',
      'Inner/outer loop optimization',
      'Few-shot learning',
      'Task distribution training',
      'Rapid adaptation',
    ],
    useCases: ['Personalization', 'Domain adaptation', 'Transfer learning', 'AI assistants'],
    algorithms: ['Model-Agnostic Meta-Learning', 'Gradient Descent', 'Few-Shot Learning', 'Task Adaptation'],
    popularity: 55,
  },

  {
    id: 'neuro-symbolic',
    title: 'Neuro-Symbolic Reasoning',
    subtitle: 'Hybrid AI: Neural Perception + Symbolic Logic',
    description: 'Combine neural networks with symbolic reasoning for interpretable AI.',
    category: 'exotic',
    difficulty: 'expert',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/neuro-symbolic/index.html',
    icon: 'Network',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Dual-system architecture',
      'Logical rule knowledge base',
      'Forward chaining inference',
      'Hybrid confidence scoring',
      'Explainable reasoning',
    ],
    useCases: ['Explainable AI', 'Medical diagnosis', 'Legal reasoning', 'Scientific hypothesis'],
    algorithms: ['Neural-Symbolic Integration', 'Forward Chaining', 'Logic Programming', 'Hybrid Inference'],
    popularity: 50,
  },

  {
    id: 'quantum-inspired',
    title: 'Quantum-Inspired Optimization',
    subtitle: 'Global Optimization via Quantum Principles',
    description: 'Use quantum mechanics concepts to escape local optima.',
    category: 'exotic',
    difficulty: 'expert',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/quantum-inspired/index.html',
    icon: 'Atom',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Quantum PSO',
      'Superposition states',
      'Quantum entanglement',
      'Energy barrier tunneling',
      'Multi-modal visualization',
    ],
    useCases: [
      'Complex optimization',
      'Neural architecture search',
      'Hyperparameter tuning',
      'Portfolio optimization',
    ],
    algorithms: ['Quantum Particle Swarm', 'Superposition', 'Quantum Tunneling', 'Entanglement'],
    popularity: 45,
  },

  {
    id: 'continual-learning',
    title: 'Continual Learning',
    subtitle: 'Lifelong Learning Without Forgetting',
    description: 'Learn new tasks sequentially while preserving previous knowledge.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/continual-learning/index.html',
    icon: 'RefreshCw',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Elastic Weight Consolidation',
      'Experience replay buffer',
      'Synaptic consolidation',
      'Progressive task learning',
      'Forgetting curve monitoring',
    ],
    useCases: ['Personal AI assistants', 'Autonomous systems', 'Educational platforms', 'Robotics'],
    algorithms: ['Elastic Weight Consolidation', 'Fisher Information', 'Experience Replay', 'Memory Consolidation'],
    popularity: 65,
  },

  // Simple/Beginner Examples
  {
    id: 'linear-regression',
    title: 'Linear Regression',
    subtitle: 'Classic Supervised Learning - Predict Continuous Values',
    description: 'Learn the fundamentals of machine learning with linear regression using gradient descent optimization.',
    category: 'standard',
    difficulty: 'beginner',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/linear-regression/index.html',
    icon: 'LineChart',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Gradient descent optimization',
      'Real-time parameter updates',
      'MSE and R² metrics',
      'Interactive scatter plot',
      'Adjustable learning rate',
    ],
    useCases: ['Price prediction', 'Trend analysis', 'Sales forecasting', 'Resource estimation'],
    algorithms: ['Linear Regression', 'Gradient Descent', 'Least Squares', 'Mean Squared Error'],
    popularity: 90,
  },

  {
    id: 'knn',
    title: 'K-Nearest Neighbors',
    subtitle: 'Instance-Based Learning for Classification',
    description: 'Simple yet powerful classification algorithm based on similarity between data points.',
    category: 'standard',
    difficulty: 'beginner',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/knn/index.html',
    icon: 'MapPin',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Adjustable K parameter (1-15)',
      'Multi-class classification',
      'Decision boundary visualization',
      'Euclidean distance metric',
      'Interactive data points',
    ],
    useCases: ['Image classification', 'Recommender systems', 'Pattern recognition', 'Anomaly detection'],
    algorithms: ['K-Nearest Neighbors', 'Euclidean Distance', 'Majority Voting', 'Distance Weighting'],
    popularity: 85,
  },

  {
    id: 'decision-tree',
    title: 'Decision Tree',
    subtitle: 'Interpretable Tree-Based Classification',
    description: 'Build interpretable decision trees using information gain and entropy-based splitting.',
    category: 'standard',
    difficulty: 'beginner',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/decision-tree/index.html',
    icon: 'Network',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Tree structure visualization',
      'Information gain calculation',
      'Pruning functionality',
      'Feature importance chart',
      'Node-level statistics',
    ],
    useCases: ['Credit scoring', 'Medical diagnosis', 'Customer segmentation', 'Risk assessment'],
    algorithms: ['Decision Tree', 'Information Gain', 'Entropy', 'Gini Index', 'Pruning'],
    popularity: 80,
  },

  {
    id: 'naive-bayes',
    title: 'Naive Bayes',
    subtitle: 'Probabilistic Classification with Bayes Theorem',
    description: 'Fast and efficient probabilistic classifier based on Bayes theorem with independence assumptions.',
    category: 'standard',
    difficulty: 'beginner',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/naive-bayes/index.html',
    icon: 'Calculator',
    gradient: ['#667eea', '#764ba2'],
    features: [
      'Probability distribution visualization',
      'Text classification demo',
      'Sentiment analysis',
      'Conditional probability display',
      'Class likelihood charts',
    ],
    useCases: ['Spam filtering', 'Sentiment analysis', 'Document classification', 'Medical diagnosis'],
    algorithms: ['Naive Bayes', 'Bayes Theorem', 'Maximum Likelihood', 'Laplace Smoothing'],
    popularity: 75,
  },

  // Intermediate Examples
  {
    id: 'random-forest',
    title: 'Random Forest',
    subtitle: 'Ensemble Learning with Decision Trees',
    description: 'Powerful ensemble method combining multiple decision trees for robust predictions.',
    category: 'standard',
    difficulty: 'intermediate',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/random-forest/index.html',
    icon: 'Trees',
    gradient: ['#06b6d4', '#3b82f6'],
    features: [
      'Ensemble of 5-100 trees',
      'Feature importance ranking',
      'Out-of-bag error estimation',
      'Bootstrap aggregating',
      'Parallel tree training',
    ],
    useCases: ['Credit risk', 'Disease prediction', 'Stock market', 'Customer churn'],
    algorithms: ['Random Forest', 'Bagging', 'Bootstrap Sampling', 'Feature Bagging', 'Majority Voting'],
    popularity: 88,
  },

  {
    id: 'svm',
    title: 'Support Vector Machine',
    subtitle: 'Maximum Margin Classification',
    description: 'Find optimal decision boundaries by maximizing the margin between classes using kernel methods.',
    category: 'standard',
    difficulty: 'intermediate',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/svm/index.html',
    icon: 'Maximize',
    gradient: ['#06b6d4', '#3b82f6'],
    features: [
      'Multiple kernel functions (Linear, RBF, Polynomial)',
      'Support vector visualization',
      'Decision boundary rendering',
      'Margin visualization',
      'Kernel parameter tuning',
    ],
    useCases: ['Face detection', 'Text categorization', 'Bioinformatics', 'Handwriting recognition'],
    algorithms: ['Support Vector Machine', 'RBF Kernel', 'Polynomial Kernel', 'SMO Algorithm', 'Hinge Loss'],
    popularity: 82,
  },

  {
    id: 'kmeans-clustering',
    title: 'K-Means Clustering',
    subtitle: 'Unsupervised Partitional Clustering',
    description: 'Discover natural groupings in data using iterative centroid-based clustering.',
    category: 'standard',
    difficulty: 'intermediate',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/kmeans-clustering/index.html',
    icon: 'Grid3x3',
    gradient: ['#06b6d4', '#3b82f6'],
    features: [
      'K-means++ initialization',
      'Voronoi diagram visualization',
      'Silhouette score calculation',
      'Elbow method optimization',
      'Real-time cluster updates',
    ],
    useCases: ['Customer segmentation', 'Image compression', 'Market basket analysis', 'Anomaly detection'],
    algorithms: ['K-Means', 'K-Means++', 'Lloyd\'s Algorithm', 'Silhouette Analysis', 'Elbow Method'],
    popularity: 86,
  },

  {
    id: 'pca',
    title: 'Principal Component Analysis',
    subtitle: 'Dimensionality Reduction & Feature Extraction',
    description: 'Reduce high-dimensional data while preserving maximum variance using eigenvalue decomposition.',
    category: 'standard',
    difficulty: 'intermediate',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/pca/index.html',
    icon: 'Layers',
    gradient: ['#06b6d4', '#3b82f6'],
    features: [
      'Eigenvalue decomposition',
      '2D/3D projection visualization',
      'Explained variance chart',
      'Scree plot analysis',
      'Component loadings display',
    ],
    useCases: ['Data visualization', 'Feature extraction', 'Noise reduction', 'Compression'],
    algorithms: ['PCA', 'Eigenvalue Decomposition', 'Singular Value Decomposition', 'Covariance Matrix'],
    popularity: 78,
  },

  // Advanced Examples
  {
    id: 'cnn',
    title: 'Convolutional Neural Network',
    subtitle: 'Deep Learning for Image Recognition',
    description: 'State-of-the-art image classification using convolutional layers and feature hierarchies.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/cnn/index.html',
    icon: 'Grid',
    gradient: ['#f59e0b', '#ef4444'],
    features: [
      'MNIST digit recognition',
      'Drawing canvas (280x280 → 28x28)',
      'Feature map visualization',
      'Convolutional layer inspection',
      'Confusion matrix analysis',
    ],
    useCases: ['Image classification', 'Object detection', 'Facial recognition', 'Medical imaging'],
    algorithms: ['CNN', 'Convolutional Layers', 'Max Pooling', 'ReLU Activation', 'Softmax Classification'],
    popularity: 92,
  },

  {
    id: 'rnn',
    title: 'Recurrent Neural Network',
    subtitle: 'Sequential Data Processing with LSTM',
    description: 'Process sequential data with memory using Long Short-Term Memory networks for text generation.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/rnn/index.html',
    icon: 'ArrowRightLeft',
    gradient: ['#f59e0b', '#ef4444'],
    features: [
      'Character-level LSTM',
      'Text generation with temperature control',
      'Hidden state visualization',
      'Gate activation monitoring',
      'Sequence prediction display',
    ],
    useCases: ['Text generation', 'Machine translation', 'Speech recognition', 'Time series prediction'],
    algorithms: ['RNN', 'LSTM', 'Backpropagation Through Time', 'Forget Gate', 'Cell State'],
    popularity: 87,
  },

  {
    id: 'gan',
    title: 'Generative Adversarial Network',
    subtitle: 'Adversarial Training for Synthetic Data',
    description: 'Train generator and discriminator networks in competition to create realistic synthetic patterns.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/gan/index.html',
    icon: 'Sparkles',
    gradient: ['#f59e0b', '#ef4444'],
    features: [
      'Generator vs Discriminator training',
      'Real-time sample generation (4x4 grid)',
      'Dual loss curve visualization',
      'Latent space exploration',
      'Training stability monitoring',
    ],
    useCases: ['Image synthesis', 'Data augmentation', 'Style transfer', 'Super-resolution'],
    algorithms: ['GAN', 'Generator Network', 'Discriminator Network', 'Adversarial Loss', 'Nash Equilibrium'],
    popularity: 84,
  },

  {
    id: 'attention-mechanism',
    title: 'Attention Mechanism',
    subtitle: 'Focus on Relevant Information Dynamically',
    description: 'Learn to focus on important parts of input sequences using attention weights and alignment.',
    category: 'advanced',
    difficulty: 'expert',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/attention-mechanism/index.html',
    icon: 'Eye',
    gradient: ['#f59e0b', '#ef4444'],
    features: [
      'Attention heatmap visualization',
      'Alignment matrix display',
      'Translation/summarization demos',
      'Token-level attention weights',
      'Multi-head attention support',
    ],
    useCases: ['Machine translation', 'Text summarization', 'Question answering', 'Image captioning'],
    algorithms: ['Attention Mechanism', 'Scaled Dot-Product Attention', 'Multi-Head Attention', 'Self-Attention', 'Query-Key-Value'],
    popularity: 89,
  },

  // Exotic Examples
  {
    id: 'evolutionary-algorithm',
    title: 'Evolutionary Algorithm',
    subtitle: 'Bio-Inspired Optimization via Natural Selection',
    description: 'Solve optimization problems using genetic algorithms with mutation, crossover, and selection.',
    category: 'exotic',
    difficulty: 'expert',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/evolutionary-algorithm/index.html',
    icon: 'Dna',
    gradient: ['#ec4899', '#8b5cf6'],
    features: [
      'Genetic algorithm optimization',
      'Population fitness tracking',
      'Mutation/crossover controls',
      'Selection pressure visualization',
      'Genetic diversity metrics',
    ],
    useCases: ['Function optimization', 'Neural architecture search', 'Scheduling problems', 'Game AI'],
    algorithms: ['Genetic Algorithm', 'Tournament Selection', 'Crossover', 'Mutation', 'Fitness Function'],
    popularity: 68,
  },

  {
    id: 'fuzzy-logic',
    title: 'Fuzzy Logic System',
    subtitle: 'Reasoning with Imprecise Information',
    description: 'Handle uncertainty and imprecision using fuzzy sets and linguistic variables for decision making.',
    category: 'exotic',
    difficulty: 'expert',
    learningType: 'hybrid',
    htmlPath: '/agentdb/examples/browser/fuzzy-logic/index.html',
    icon: 'Puzzle',
    gradient: ['#ec4899', '#8b5cf6'],
    features: [
      'Temperature control system demo',
      'Membership function visualization',
      'Rule firing strength display',
      'Mamdani inference engine',
      'Defuzzification methods',
    ],
    useCases: ['Control systems', 'Expert systems', 'Decision support', 'Pattern recognition'],
    algorithms: ['Fuzzy Logic', 'Membership Functions', 'Mamdani Inference', 'Defuzzification', 'Fuzzy Rules'],
    popularity: 62,
  },

  {
    id: 'capsule-networks',
    title: 'Capsule Networks',
    subtitle: 'Hierarchical Feature Relationships via Dynamic Routing',
    description: 'Preserve spatial relationships between features using capsules and dynamic routing algorithms.',
    category: 'exotic',
    difficulty: 'expert',
    learningType: 'supervised',
    htmlPath: '/agentdb/examples/browser/capsule-networks/index.html',
    icon: 'Box',
    gradient: ['#ec4899', '#8b5cf6'],
    features: [
      'Dynamic routing algorithm',
      'Capsule activation visualization',
      'Routing coefficient heatmap',
      'Pose parameter display',
      'Part-whole relationships',
    ],
    useCases: ['Viewpoint-invariant recognition', 'Object detection', 'Image segmentation', 'Medical imaging'],
    algorithms: ['Capsule Networks', 'Dynamic Routing', 'Squashing Function', 'Routing-by-Agreement', 'Vector Capsules'],
    popularity: 58,
  },

  {
    id: 'hyperdimensional-computing',
    title: 'Hyperdimensional Computing',
    subtitle: 'Brain-Inspired Computing with High-Dimensional Vectors',
    description: 'Leverage ultra-high dimensional binary vectors for robust, efficient cognitive computing.',
    category: 'exotic',
    difficulty: 'expert',
    learningType: 'unsupervised',
    htmlPath: '/agentdb/examples/browser/hyperdimensional-computing/index.html',
    icon: 'Boxes',
    gradient: ['#ec4899', '#8b5cf6'],
    features: [
      'High-dimensional binary vectors (1000-10000D)',
      'Hamming distance similarity',
      'Language recognition demo (6 languages)',
      'PCA projection visualization',
      'Vector bundling operations',
    ],
    useCases: ['Cognitive computing', 'Robotics', 'IoT edge devices', 'Brain-computer interfaces'],
    algorithms: ['Hyperdimensional Computing', 'Binary Spatter Codes', 'Hamming Distance', 'Vector Bundling', 'Holographic Reduced Representations'],
    popularity: 54,
  },
];

/**
 * Get example by ID
 */
export function getExampleById(id: string): WasmExample | undefined {
  return WASM_EXAMPLES.find((ex) => ex.id === id);
}

/**
 * Get examples by category
 */
export function getExamplesByCategory(category: LearningCategory): WasmExample[] {
  return WASM_EXAMPLES.filter((ex) => ex.category === category);
}

/**
 * Get examples by difficulty
 */
export function getExamplesByDifficulty(difficulty: DifficultyLevel): WasmExample[] {
  return WASM_EXAMPLES.filter((ex) => ex.difficulty === difficulty);
}

/**
 * Get examples by learning type
 */
export function getExamplesByLearningType(learningType: LearningType): WasmExample[] {
  return WASM_EXAMPLES.filter((ex) => ex.learningType === learningType);
}

/**
 * Filter and sort examples based on filter state
 */
export function filterExamples(filters: FilterState): WasmExample[] {
  let filtered = WASM_EXAMPLES;

  // Search filter
  if (filters.search) {
    const search = filters.search.toLowerCase();
    filtered = filtered.filter(
      (ex) =>
        ex.title.toLowerCase().includes(search) ||
        ex.description.toLowerCase().includes(search) ||
        ex.features.some((f) => f.toLowerCase().includes(search)) ||
        ex.useCases.some((u) => u.toLowerCase().includes(search)) ||
        ex.algorithms.some((a) => a.toLowerCase().includes(search))
    );
  }

  // Category filter
  if (filters.categories.length > 0) {
    filtered = filtered.filter((ex) => filters.categories.includes(ex.category));
  }

  // Difficulty filter
  if (filters.difficulty.length > 0) {
    filtered = filtered.filter((ex) => filters.difficulty.includes(ex.difficulty));
  }

  // Learning type filter
  if (filters.learningType.length > 0) {
    filtered = filtered.filter((ex) => filters.learningType.includes(ex.learningType));
  }

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let comparison = 0;

    switch (filters.sortBy) {
      case 'alphabetical':
        comparison = a.title.localeCompare(b.title);
        break;
      case 'popularity':
        comparison = (a.popularity || 0) - (b.popularity || 0);
        break;
      case 'difficulty': {
        const difficultyOrder = { beginner: 1, intermediate: 2, advanced: 3, expert: 4 };
        comparison = difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
        break;
      }
      case 'recent': {
        const aDate = a.lastUpdated?.getTime() || 0;
        const bDate = b.lastUpdated?.getTime() || 0;
        comparison = aDate - bDate;
        break;
      }
    }

    return filters.sortOrder === 'asc' ? comparison : -comparison;
  });

  return sorted;
}
