import { useState, useEffect } from 'react';
import { RoomPadAvailable } from './components/RoomPadAvailable';
import { RoomPadInUse } from './components/RoomPadInUse';
import { ReservationModal } from './components/ReservationModal';
import { NightModeModal } from './components/NightModeModal';
import { ActivationScreen } from './components/ActivationScreen';
import { InitialLoadingScreen } from './components/InitialLoadingScreen';
import { Settings } from 'lucide-react';

type ViewMode = 'available' | 'in-use';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isActivated, setIsActivated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('available');
  const [showReservationModal, setShowReservationModal] = useState(false);
  const [showNightModeModal, setShowNightModeModal] = useState(false);

  useEffect(() => {
    // Initial loading
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  // Show initial loading screen
  if (isLoading) {
    return (
      <div className="size-full bg-white flex items-center justify-center">
        <div className="w-[1280px] h-[800px] bg-white shadow-2xl overflow-hidden">
          <InitialLoadingScreen />
        </div>
      </div>
    );
  }

  // Show activation screen if not activated
  if (!isActivated) {
    return (
      <div className="size-full bg-white flex items-center justify-center">
        <div className="w-[1280px] h-[800px] bg-white shadow-2xl overflow-hidden">
          <ActivationScreen onActivated={() => setIsActivated(true)} />
        </div>
      </div>
    );
  }

  return (
    <div className="size-full bg-white flex items-center justify-center">
      <div className="w-[1280px] h-[800px] bg-white shadow-2xl overflow-hidden">
      {/* Control panel for demo switching */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex gap-2 bg-white/90 backdrop-blur-sm rounded-full p-2 shadow-lg">
        <button
          onClick={() => setViewMode('available')}
          className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
            viewMode === 'available'
              ? 'bg-[#F27059] text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          예약 가능 상태
        </button>
        <button
          onClick={() => setViewMode('in-use')}
          className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
            viewMode === 'in-use'
              ? 'bg-[#F27059] text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          사용 중 상태
        </button>
      </div>

      {/* Settings Button */}
      <button
        onClick={() => setShowNightModeModal(true)}
        className="fixed top-4 right-4 z-40 bg-white/90 backdrop-blur-sm rounded-full p-4 shadow-lg hover:bg-white transition-all active:scale-95"
        title="야간 절전 설정"
      >
        <Settings size={24} className="text-[#2B3A55]" />
      </button>

      {/* Main content */}
      {viewMode === 'available' ? (
        <RoomPadAvailable
          onReserve={() => setShowReservationModal(true)}
          onTimeSlotClick={() => setShowReservationModal(true)}
        />
      ) : (
        <RoomPadInUse onTimeSlotClick={() => setShowReservationModal(true)} />
      )}

      {/* Reservation Modal */}
      {showReservationModal && (
        <ReservationModal onClose={() => setShowReservationModal(false)} />
      )}

      {/* Night Mode Settings Modal */}
      {showNightModeModal && (
        <NightModeModal
          onClose={() => setShowNightModeModal(false)}
          onDisconnect={() => setIsActivated(false)}
        />
      )}
      </div>
    </div>
  );
}