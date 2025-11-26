
describe('Example Test Suite', () => {
    it('should add two numbers correctly', () => {
        const result = 2 + 2;
        expect(result).toBe(4);
    });

    it('should check if array contains value', () => {
        const fruits = ['apple', 'banana', 'orange'];
        expect(fruits).toContain('banana');
    });

    it('should verify object properties', () => {
        const user = { name: 'John', age: 30 };
        expect(user).toHaveProperty('name');
        expect(user.name).toBe('John');
    });
});