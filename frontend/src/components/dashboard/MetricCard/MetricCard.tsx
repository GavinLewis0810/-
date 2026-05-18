import React from 'react';
import styles from './MetricCard.module.css';

interface MetricCardProps {
  label: string;
  value: string | number;
  prefix?: string;
  icon?: React.ReactNode;
  gradient?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, prefix = '', icon, gradient }) => {
  return (
    <div className={styles.metricCard}>
      <div className={styles.cardBg} style={gradient ? { background: `linear-gradient(135deg, ${gradient})` } : undefined} />
      <div className={styles.cardContent}>
        <div className={styles.cardLeft}>
          <div className={styles.label}>{label}</div>
          <div className={styles.value}>
            {prefix}{value}
          </div>
        </div>
        {icon && (
          <div
            className={styles.iconWrap}
            style={gradient ? { background: `linear-gradient(135deg, ${gradient})` } : undefined}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricCard;
