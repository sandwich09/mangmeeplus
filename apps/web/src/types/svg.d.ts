/**
 * Type declaration for SVG files imported as React components via @svgr/webpack.
 * MIT-licensed icons sourced from TailAdmin 2.3.0.
 */
declare module '*.svg' {
  import type React from 'react';
  const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}
