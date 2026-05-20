import React, { useEffect, useRef } from 'react';
import { Viewer } from 'mapillary-js';
import 'mapillary-js/dist/mapillary.css';
import { X, ExternalLink } from 'lucide-react';

interface Props {
  imageId: string;
  accessToken: string;
  onClose: () => void;
}

export const StreetLevelViewer: React.FC<Props> = ({ imageId, accessToken, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize the viewer
    const viewer = new Viewer({
      accessToken: accessToken,
      container: containerRef.current,
      imageId: imageId,
    });

    viewerRef.current = viewer;

    // We can add nodechanged event listeners here if we want to sync the map
    viewer.on('nodechanged', (node) => {
      // Future enhancement: emit an event or call a callback to update a marker on the main map
    });

    return () => {
      // Clean up the viewer on unmount to prevent WebGL context leaks
      if (viewerRef.current) {
        viewerRef.current.remove();
        viewerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]); // Only re-init if accessToken changes

  // Update imageId if it changes without recreating the viewer
  useEffect(() => {
    if (viewerRef.current && imageId) {
      viewerRef.current.moveTo(imageId).catch(err => {
        console.error("Mapillary moveTo failed", err);
      });
    }
  }, [imageId]);

  // Handle window resize properly
  useEffect(() => {
    const handleResize = () => {
      if (viewerRef.current) {
        viewerRef.current.resize();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="relative w-full h-full bg-slate-950 flex flex-col border-l border-slate-800 shadow-2xl">
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <a 
          href={`https://www.mapillary.com/app/?pKey=${imageId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-slate-900/80 hover:bg-slate-700 text-slate-300 p-2 rounded-full backdrop-blur transition-colors border border-slate-700"
          title="Open in Mapillary"
        >
          <ExternalLink size={20} />
        </a>
        <button 
          onClick={onClose}
          className="bg-slate-900/80 hover:bg-pink-600 text-slate-300 hover:text-white p-2 rounded-full backdrop-blur transition-colors border border-slate-700"
          title="Close Viewer"
        >
          <X size={20} />
        </button>
      </div>
      <div className="absolute bottom-4 left-4 z-10 pointer-events-none">
        <div className="bg-slate-900/80 backdrop-blur rounded px-3 py-1 text-xs font-mono text-slate-300 border border-slate-700">
          IMG_ID: {imageId}
        </div>
      </div>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
