import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { FilterState } from '@/types/wasm-examples';
import { useState } from 'react';

interface ExampleFiltersProps {
  filters: FilterState;
  onChange: (filters: Partial<FilterState>) => void;
}

export const ExampleFilters = ({ filters, onChange }: ExampleFiltersProps) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSearchChange = (value: string) => {
    onChange({ search: value });
  };

  const handleReset = () => {
    onChange({
      search: '',
      categories: [],
      difficulty: [],
      learningType: [],
      sortBy: 'popularity',
      sortOrder: 'desc'
    });
  };

  const activeFilterCount =
    filters.categories.length +
    filters.difficulty.length +
    filters.learningType.length +
    (filters.search ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search examples..."
            value={filters.search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        <Button
          variant="outline"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="gap-2"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {activeFilterCount}
            </Badge>
          )}
        </Button>

        {activeFilterCount > 0 && (
          <Button variant="ghost" onClick={handleReset} className="gap-2">
            <X className="h-4 w-4" />
            Reset
          </Button>
        )}
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-panel rounded-lg border border-line">
          {/* Category Filter */}
          <div>
            <label className="text-sm font-medium mb-2 block">Category</label>
            <Select
              value={filters.categories[0] || 'all'}
              onValueChange={(value) =>
                onChange({ categories: value === 'all' ? [] : [value as any] })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="standard">Standard Learning</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
                <SelectItem value="exotic">Exotic</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Difficulty Filter */}
          <div>
            <label className="text-sm font-medium mb-2 block">Difficulty</label>
            <Select
              value={filters.difficulty[0] || 'all'}
              onValueChange={(value) =>
                onChange({ difficulty: value === 'all' ? [] : [value as any] })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All levels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
                <SelectItem value="expert">Expert</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sort Filter */}
          <div>
            <label className="text-sm font-medium mb-2 block">Sort By</label>
            <Select
              value={filters.sortBy}
              onValueChange={(value) =>
                onChange({ sortBy: value as any })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="popularity">Popularity</SelectItem>
                <SelectItem value="alphabetical">Alphabetical</SelectItem>
                <SelectItem value="difficulty">Difficulty</SelectItem>
                <SelectItem value="recent">Recently Updated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
};
