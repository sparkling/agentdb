import { ExampleCard } from './ExampleCard';
import { WasmExample } from '@/types/wasm-examples';

interface ExampleGridProps {
  examples: WasmExample[];
  loading?: boolean;
}

export const ExampleGrid = ({ examples, loading }: ExampleGridProps) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-64 bg-panel rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (examples.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground text-lg">
          No examples found. Try adjusting your filters.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {examples.map((example) => (
        <ExampleCard key={example.id} example={example} />
      ))}
    </div>
  );
};
