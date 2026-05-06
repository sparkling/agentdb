import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WasmExample } from '@/types/wasm-examples';
import { ArrowRight } from 'lucide-react';
import * as Icons from 'lucide-react';
import { getDifficultyColor } from '@/lib/wasm-helpers';

interface ExampleCardProps {
  example: WasmExample;
}

export const ExampleCard = ({ example }: ExampleCardProps) => {
  const navigate = useNavigate();

  // Dynamically get icon component
  const Icon = (Icons as any)[example.icon] || Icons.FileCode;

  const handleClick = () => {
    navigate(`/demo/${example.id}`);
  };

  return (
    <Card
      className="group cursor-pointer hover:border-cyan/50 transition-all hover:shadow-lg hover:shadow-cyan/10 hover:-translate-y-1"
      onClick={handleClick}
    >
      <CardHeader>
        <div className="flex justify-between items-start mb-3">
          <div className="p-2 bg-cyan/10 rounded-lg">
            <Icon className="h-6 w-6 text-cyan" />
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="capitalize">
              {example.category}
            </Badge>
          </div>
        </div>

        <CardTitle className="text-cyan group-hover:text-cyan/80 transition-colors">
          {example.title}
        </CardTitle>
        <CardDescription>{example.subtitle}</CardDescription>
      </CardHeader>

      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
          {example.description}
        </p>

        {/* Features */}
        <div className="flex flex-wrap gap-2 mb-4">
          {example.features.slice(0, 2).map((feature, i) => (
            <Badge key={i} variant="secondary" className="text-xs">
              {feature}
            </Badge>
          ))}
          {example.features.length > 2 && (
            <Badge variant="secondary" className="text-xs">
              +{example.features.length - 2} more
            </Badge>
          )}
        </div>

        {/* Difficulty Badge */}
        <Badge className={getDifficultyColor(example.difficulty)}>
          {example.difficulty}
        </Badge>
      </CardContent>

      <CardFooter>
        <Button
          variant="ghost"
          className="w-full group-hover:bg-cyan/10 group-hover:text-cyan"
        >
          Explore Example
          <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
        </Button>
      </CardFooter>
    </Card>
  );
};
