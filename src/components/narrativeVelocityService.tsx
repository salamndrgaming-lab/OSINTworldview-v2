import React, { useState, useEffect } from 'react';
import { NarrativeVelocityService } from '../../services/narrativeVelocityService';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

export const NarrativeVelocityPanel: React.FC = () => {
  const [velocityData, setVelocityData] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [selectedNarrative, setSelectedNarrative] = useState<string | null>(null);
  
  useEffect(() => {
    const loadData = async () => {
      // Fetch from Redis and calculate velocities
      // Implementation...
    };
    
    loadData();
    const interval = setInterval(loadData, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="narrative-velocity-panel">
      <h2>Telegram Narrative Velocity Tracker</h2>
      <p>Real-time narrative acceleration across 27+ channels with baseline comparison</p>
      
      <div className="alerts-section">
        <h3>Active Alerts ({alerts.length})</h3>
        {alerts.map((alert, idx) => (
          <div key={idx} className="velocity-alert">
            <strong>{alert.keyword}</strong>
            <span className="acceleration">
              {alert.accelerationFactor.toFixed(1)}x baseline
            </span>
            <span className="channels">{alert.channels.length} channels</span>
          </div>
        ))}
      </div>
      
      <div className="velocity-chart">
        <LineChart width={800} height={400} data={velocityData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="current" stroke="#8884d8" name="Current" />
          <Line type="monotone" dataKey="baseline" stroke="#82ca9d" name="Baseline" />
        </LineChart>
      </div>
    </div>
  );
};