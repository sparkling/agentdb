import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WasmExample } from '@/types/wasm-examples';
import { Github, ExternalLink } from 'lucide-react';
import * as Icons from 'lucide-react';
import { getDifficultyColor, getCategoryColor } from '@/lib/wasm-helpers';

interface ExampleHeaderProps {
  example: WasmExample;
}

export const ExampleHeader = ({ example }: ExampleHeaderProps) => {
  const Icon = (Icons as any)[example.icon] || Icons.FileCode;

  return (
    <div className="border-b border-line pb-6">
      <div className="flex items-start justify-between">
        <div className="flex gap-4">
          <div className="p-3 bg-cyan/10 rounded-lg">
            <Icon className="h-8 w-8 text-cyan" />
          </div>

          <div>
            <div className="flex gap-2 mb-2">
              <Badge variant="outline" className={getCategoryColor(example.category)}>
                {example.category}
              </Badge>
              <Badge className={getDifficultyColor(example.difficulty)}>
                {example.difficulty}
              </Badge>
              <Badge variant="outline">{example.learningType}</Badge>
            </div>

            <h1 className="text-3xl font-bold mb-2">{example.title}</h1>
            <p className="text-lg text-muted-foreground mb-4">
              {example.subtitle}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {example.sourceUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={example.sourceUrl} target="_blank" rel="noopener noreferrer">
                <Github className="h-4 w-4 mr-2" />
                Source
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href={example.htmlPath} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Standalone
            </a>
          </Button>
        </div>
      </div>

      <p className="text-foreground mt-4">{example.description}</p>
    </div>
  );
};
