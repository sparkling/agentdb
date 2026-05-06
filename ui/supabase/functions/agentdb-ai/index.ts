import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, code, data, context, model = "google/gemini-2.5-flash" } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    let systemPrompt = "";
    let userPrompt = "";

    // Configure prompts based on operation type
    switch (type) {
      case "analyze":
        systemPrompt = "You are an expert market analyst specializing in multi-source data analysis. Provide clear, actionable trading insights based on market data, sentiment, and predictions.";
        userPrompt = context || "Analyze the provided market data";
        break;

      case "optimize":
        systemPrompt = "You are an expert in optimizing AgentDB code for performance, memory efficiency, and best practices. Analyze the code and provide specific, actionable optimization suggestions.";
        userPrompt = `Optimize this AgentDB code:\n\n${code}\n\nContext: ${context || "General optimization"}`;
        break;
      
      case "train":
        systemPrompt = "You are an expert in machine learning and neural networks. Help train and configure AgentDB models with optimal hyperparameters and training strategies.";
        userPrompt = `Help configure training for this AgentDB model:\n\nCode: ${code}\nData: ${JSON.stringify(data)}\nContext: ${context || "Training configuration"}`;
        break;
      
      case "manage":
        systemPrompt = "You are an expert in AgentDB architecture and data management. Provide guidance on best practices for managing agents, memory, and reasoning systems.";
        userPrompt = `Provide management guidance for:\n\n${code || data}\n\nContext: ${context || "General management"}`;
        break;
      
      case "debug":
        systemPrompt = "You are an expert debugger for AgentDB applications. Identify issues, explain errors, and provide solutions.";
        userPrompt = `Debug this AgentDB code:\n\n${code}\n\nError/Issue: ${context || "General debugging"}`;
        break;
      
      case "generate":
        systemPrompt = "You are an expert AgentDB developer. Generate clean, efficient, and well-documented code following best practices.";
        userPrompt = `Generate AgentDB code for: ${context}\n\nRequirements: ${code || data || "Standard implementation"}`;
        break;
      
      default:
        systemPrompt = "You are an expert in AgentDB, machine learning, and AI systems. Provide helpful, accurate guidance.";
        userPrompt = `${context || "Help with:"}\n\n${code || data || ""}`;
    }

    console.log(`Processing ${type} request with model ${model}`);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI gateway error", status: response.status, details: errorText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const aiResponse = result.choices?.[0]?.message?.content;

    if (!aiResponse) {
      throw new Error("No response from AI");
    }

    console.log(`Successfully processed ${type} request`);

    return new Response(
      JSON.stringify({ 
        response: aiResponse,
        type,
        model 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in agentdb-ai function:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error occurred" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
