import { createContext, useContext, useState, type ReactNode } from 'react';

interface LabModeContextType {
    labMode: boolean;
    setLabMode: (value: boolean) => void;
    toggleLabMode: () => void;
}

const LabModeContext = createContext<LabModeContextType>({
    labMode: false,
    setLabMode: () => {},
    toggleLabMode: () => {},
});

export const useLabMode = () => useContext(LabModeContext);

export const LabModeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [labMode, setLabMode] = useState(false);
    const toggleLabMode = () => setLabMode(prev => !prev);

    return (
        <LabModeContext.Provider value={{ labMode, setLabMode, toggleLabMode }}>
            {children}
        </LabModeContext.Provider>
    );
};

export default LabModeContext;
