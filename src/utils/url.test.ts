import { headingToFragmentId } from './url';

// Simple tests for headingToFragmentId
console.log('Testing headingToFragmentId function:');

const testCases = [
  {
    heading: 'Develop, Customize, and Test',
    expected: '#develop-customize-and-test',
  },
  {
    heading: 'Getting Started: Quick Guide',
    expected: '#getting-started-quick-guide',
  },
  {
    heading: 'API Reference (v2.0)',
    expected: '#api-reference-v20',
  },
  {
    heading: 'Authentication & Authorization',
    expected: '#authentication-authorization',
  },
  {
    heading: 'Common Issues/Problems',
    expected: '#common-issuesproblems',
  },
  {
    heading: 'Step 1: Install the SDK',
    expected: '#step-1-install-the-sdk',
  },
  {
    heading: 'Using the [Example] Code',
    expected: '#using-the-example-code',
  },
];

testCases.forEach((test) => {
  const result = headingToFragmentId(test.heading);
  const passed = result === test.expected;
  console.log(
    `${passed ? '✅' : '❌'} "${test.heading}" → "${result}" ${!passed ? `(expected "${test.expected}")` : ''}`
  );
});

console.log('\nDone!');
