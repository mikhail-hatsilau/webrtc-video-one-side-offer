import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';

export default {
    input: 'src/new-flow.js',
    output: {
        file: 'dist/bundle.js',
        format: 'iife',
    },
    plugins: [
        resolve({
            jsnext: true,
            main: true,
            browser: true,
            preferBuiltins: false,
        }),
        commonjs(),
        nodeResolve(),
        copy({
            targets: [
                {
                    src: ['src/index.html', 'src/index.css'],
                    dest: 'dist',
                },
            ],
        }),
    ],
};
