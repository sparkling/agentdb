import { useState, useEffect } from 'react';
import { WasmExample } from '@/types/wasm-examples';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ExampleIframeProps {
  example: WasmExample;
}

export const ExampleIframe = ({ example }: ExampleIframeProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
  }, [example.id]);

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-panel rounded-lg">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-cyan mx-auto mb-2" />
            <p className="text-muted-foreground">Loading example...</p>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load example. Please try refreshing the page.
          </AlertDescription>
        </Alert>
      )}

      <iframe
        src={example.htmlPath}
        className="w-full h-[600px] md:h-[700px] lg:h-[800px] rounded-lg border border-line"
        sandbox="allow-scripts allow-same-origin allow-forms"
        loading="lazy"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
        title={`${example.title} - Interactive Demo`}
      />
    </div>
  );
};
