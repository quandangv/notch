# Notch & NeoRune script structure summary

## NeoRune

Programming languages typically represent expressions in the infix notation. An expression such as `(a+b)^2` put the operator between the operands, which leads to the following problems:
- **Brackets and the concept of precedence** had to be invented just to denote the order of execution
- **Code must be chopped up into commands** so that we can write it in the order of execution. This is because the order of execution in infix notation is determined by precedence and brackets, in conflict with the fact that we expect the order of execution to be the order that commands appear in code
- **Unary and binary are the only types of operator possible**: Operators with more arguments must be denoted as functions, which have an entirely different notation

In the early stages of NeoRune, I found that the postfix notation (a.k.a. the Reverse Polish Notation) is a notation much more suitable for programming than infix. Here are example comparisons between code written in the infix (JavaScript) and postfix (NeoRune) notation:
```
# infix
(a+b)*(c+d)
let tmp = a; a = b; b = tmp;
array.slice(2, 4)

# postfix
a b + c d + *
a b a= b=
array 2 4 //
```
In the first example, the order of the operators in the script is the same as the order of execution. The script doesn't have to use any bracket or define any operator precedence. Thanks to this natural way of coding, we can seamlessly swap the two variables without using any temporary in the second example. In the third example, we defined `//` to be the slice operator for arrays; it's a ternary operator, taking 3 arguments as inputs, instead of having to phrase it as a function. It should also be noted that in postfix notation, spaces between the notation "words" can not be omitted.

Additionally, I have added some notations to make NeoRune code more concise, such as the comma `,` prefix, which would cause the operator to retain its first argument on the computation stack for later use. With that in mind, here are some expressions represented in NeoRune:
```
(a+b)*(a+b)     # infix
a b + ,*        # posfix
---
The comma caused the "*" operator to retain its first argument, which is used again by its second argument, leading to a square operation.
```
```
if(a % 2) return "odd" else return "even"   # infix
2 a% &{ "odd" ; "even" }                    # postfix
---
When "a" get incorporated to "%", it becomes the first argument of the operator, despite appearing after the other arguments. "&{...;...}" denotes an if...else branch
```
```
Define array and map data structures
---
# infix
["alice", "bob", "charlie"]
{a:1, b:2, c:3}
# postfix
:[ "alice" "bob" "charlie" ]
@[ 1 a= 2 b= 3 c= ]
---
":[...]" and "@[...]" directly use the stack and the scope to create new arrays and maps
```
```
Generate the 10th fibonacci number
---
let a = 1, b = 0; for(let i = 0; i < 10; i++) { let sum = a+b; a = b; b = sum } return b  # infix
1 0 10 #( :,+ )                                                                           # postfix
---
The "#(...)" bracket pair captures the value 10 and loop the code it enclose 10 times. The ":" prefix causes the penultimate stack value to be captured, while the "," prefix causes the last stack value to be retained.
```
```
NeoRune function to generate fibonacci numbers
---
[ 1 0 ?#( :,+ ) ] fibonacci=
10 .fibonacci.  # returns 55
10 .fibonacci.. # returns 34 and 55
10 .fibonacci!  # returns no value
---
In the function, the "?" prefix causes the loop to capture the third-to-last value on the stack, which would be the value passed to the function itself. Functions are defined using the "[...]" brackets in NeoRune. When functions are called:
- The number of its arguments must be explicitly specified using prefixes, and
- The number of its return values specified using suffixes.
```
```
1 2 3 4 &+
---
The "&" captures all values on the stack to calculate the sum.
```
There are more features of NeoRune than this brief summary can explain, let's now move on to the Notch script structure.

## Notch (incomplete)

The design for Notch script is based on the CSV format. It uses semicolons `;` to separate columns, and a column separator followed by a line break `;\n` to separate rows. Prefixes can be added to column separators to denote the data type of the column:
- **Text cells**: `"";` or `";`
- **Formula cells**: `!;`
- **Escaped semicolon**: `;\`
```
Expense ""; Amount "";
Repairs ""; 4600 ;
Rent ""; 4500 ;
Taxes ""; 3200 ;
Total ""; B$1:B1 &+ !;
```