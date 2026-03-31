// src/components/AnalystTab/AnalystTab.tsx
// BUG FIX 4: Analyst tab with proper data loading and polling

import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAnalystData } from '../../store/analystSlice';
import { RootState } from '../../store';
import { AnalystSection } from './AnalystSection';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ErrorBoundary } from '../common/ErrorBoundary';

export const AnalystTab: React.FC = () => {
  const dispatch = useDispatch();
  const { data, loading, error, lastUpdated } = useSelector(
    (state: RootState) => state.analyst
  );

  const [sections, setSections] = useState({
    intelligence: [] as any[],
    correlation: [] as any[],
    threats: [] as any[],
    analysis: [] as any[],
  });

  useEffect(() => {
    dispatch(fetchAnalystData() as any);

    const interval = setInterval(() => {
      dispatch(fetchAnalystData() as any);
    }, 30000);

    return () => clearInterval(interval);
  }, [dispatch]);

  useEffect(() => {
    if (data) {
      setSections({
        intelligence: data.intelligence || [],
        correlation: data.correlation || [],
        threats: data.threats || [],
        analysis: data.analysis || [],
      });
    }
  }, [data]);

  if (loading && !data) {
    return (
      <div className="analyst-tab loading">
        <LoadingSpinner />
        <p>Loading analyst data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="analyst-tab error">
        <h3>Error Loading Data</h3>
        <p>{error}</p>
        <button onClick={() => dispatch(fetchAnalystData() as any)}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="analyst-tab">
        <div className="analyst-header">
          <h2>Analyst Dashboard</h2>
          {lastUpdated && (
            <span className="last-updated">
              Last updated: {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="analyst-sections">
          <AnalystSection
            title="Intelligence Briefs"
            data={sections.intelligence}
            icon="intelligence"
            emptyMessage="No intelligence briefs available"
          />

          <AnalystSection
            title="Correlation Analysis"
            data={sections.correlation}
            icon="correlation"
            emptyMessage="No correlations detected"
          />

          <AnalystSection
            title="Threat Assessment"
            data={sections.threats}
            icon="threats"
            emptyMessage="No active threats"
          />

          <AnalystSection
            title="Detailed Analysis"
            data={sections.analysis}
            icon="analysis"
            emptyMessage="No analysis reports available"
          />
        </div>
      </div>
    </ErrorBoundary>
  );
};
