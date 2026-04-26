import { Loader2 } from 'lucide-react';

export function InitialLoadingScreen() {
  return (
    <div className="w-full h-full bg-[#F8FAFC] flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-[#2B3A55] mb-12">SAOK ROOM PAD</h1>

        <div className="mb-8">
          <Loader2 size={80} className="text-[#F27059] animate-spin mx-auto" strokeWidth={2} />
        </div>

        <p className="text-xl text-gray-500">시스템을 준비하고 있습니다...</p>
      </div>
    </div>
  );
}
